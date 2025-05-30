const express = require('express');
const cors = require('cors');
const multer = require('multer'); // Keep for potential future use or if other routes need it
const path = require('path');
const fs = require('fs'); // Use synchronous fs for initial setup
const fsp = require('fs').promises; // Use promises for async operations
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const VideoGenerator = require('./services/videoGenerator'); // Ensure this path is correct
const { validatePrompt, sanitizeInput } = require('./utils/validation'); // Ensure this path is correct
const { logger } = require('./utils/logger'); // Ensure this path is correct

const app = express();
const PORT = process.env.PORT || 3000;

// Create necessary directories if they don't exist
const UPLOADS_DIR = path.resolve('./uploads'); // For file uploads if you use image-to-video or other features
const GENERATED_DIR = path.resolve('./generated'); // For generated videos

[UPLOADS_DIR, GENERATED_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`Created directory: ${dir}`);
    }
});

// Initialize video generator service
const videoGen = new VideoGenerator({
    // No specific config needed here if Fal client reads from env,
    // but keep openaiKey if using prompt enhancement
    openaiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || `http://localhost:${PORT}`,
    credentials: true
}));

app.use(express.json({ limit: '10mb' })); // For parsing application/json
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // For parsing application/x-www-form-urlencoded

// Serve static files from frontend public directory
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Rate limiting for generation endpoint
const generateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 generation requests per windowMs
    message: { error: 'Too many generation requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Multer storage configuration (if you re-enable image-to-video or other uploads)
const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
        const uniqueName = crypto.randomUUID() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/; // Adjust if video input is needed
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            logger.warn(`Invalid file type attempt: ${file.originalname}, mimetype: ${file.mimetype}`);
            cb(new Error('Invalid file type. Allowed: jpeg, jpg, png, gif'));
        }
    }
});

// ====================================
// API ROUTES
// ====================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            falAiAvailable: !!process.env.FAL_KEY, // Check for FAL_KEY
            openaiAvailable: !!process.env.OPENAI_API_KEY
        }
    });
});

app.post('/api/generate/text-to-video', generateLimiter, async (req, res) => {
    try {
        const {
            prompt,
            quality = '1080p',       // Mapped to num_inference_steps in videoGenerator
            styleIntensity = 7,    // Mapped to guidance_scale in videoGenerator
            // Parameters like duration, frameRate, model, motionDynamics are not directly
            // used by LTX Video via Fal AI based on the schema provided.
            // The videoGenerator.js will handle mapping these conceptual frontend
            // params to actual LTX Video params where possible.
        } = req.body;

        const validation = validatePrompt(prompt);
        if (!validation.isValid) {
            logger.warn(`Invalid prompt received: "${prompt}"`, { errors: validation.errors });
            return res.status(400).json({
                error: 'Invalid prompt',
                details: validation.errors
            });
        }

        const sanitizedPrompt = sanitizeInput(prompt);
        const jobId = crypto.randomUUID();

        logger.info(`Starting LTX Video generation job ${jobId}`, {
            promptLength: sanitizedPrompt.length, // Log length for privacy if needed
            qualityFromUser: quality,
            styleIntensityFromUser: styleIntensity
        });

        // Async generation: Call videoGen but don't await the promise here.
        // The promise will resolve/reject independently.
        videoGen.generateFromText({
            prompt: sanitizedPrompt,
            quality,
            styleIntensity,
            jobId
        }).catch(error => {
            // This catch is for errors thrown *synchronously* by generateFromText
            // or if the promise returned by it is immediately rejected.
            // Asynchronous errors within the generation process itself are logged
            // inside videoGenerator.js and update the job status there.
            logger.error(`Initial LTX Video generation call error for job ${jobId}: ${error.message}`);
            // Optionally, update job status to failed here if it's an early error
            // videoGen.updateJobStatus(jobId, { status: 'failed', message: `Setup error: ${error.message}` });
        });

        // LTX Video generation time can vary greatly. This is a very rough estimate.
        // Fal AI's `subscribe` handles polling, so client doesn't need exact time.
        const estimatedTime = 60; // Placeholder estimate in seconds

        res.status(202).json({ // HTTP 202 Accepted: request accepted, processing in progress
            success: true,
            jobId,
            message: 'LTX Video generation request accepted. Check job status for updates.',
            estimatedTimeInSeconds: estimatedTime
        });

    } catch (error) {
        // This catch handles errors within the try block of the route handler itself
        // (e.g., issues with req.body parsing, crypto.randomUUID, initial logging)
        logger.error('Error in /api/generate/text-to-video route handler:', {
            message: error.message,
            stack: error.stack // Log stack in dev for easier debugging
        });
        res.status(500).json({
            error: 'Internal server error during request setup',
            message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred.'
        });
    }
});

app.get('/api/job/:jobId/status', async (req, res) => {
    try {
        const { jobId } = req.params;
        if (!jobId || typeof jobId !== 'string' || jobId.length < 10) {
            return res.status(400).json({ error: 'Invalid Job ID format' });
        }
        const status = await videoGen.getJobStatus(jobId);
        res.json(status);
    } catch (error) {
        logger.warn(`Job status check error for '${req.params.jobId}': ${error.message}`);
        if (error.message.toLowerCase().includes('job not found')) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.status(500).json({
            error: 'Failed to check job status',
            message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred.'
        });
    }
});

app.get('/api/download/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        if (!jobId || typeof jobId !== 'string' || jobId.length < 10) {
            return res.status(400).json({ error: 'Invalid Job ID format for download' });
        }
        const videoPath = await videoGen.getVideoPath(jobId);

        // Ensure file exists before attempting to stream
        await fsp.access(videoPath, fs.constants.F_OK);

        const filename = `neural_genesis_${jobId}${path.extname(videoPath) || '.mp4'}`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        // Dynamically set Content-Type based on file extension or store it with the job
        const contentType = path.extname(videoPath) === '.webm' ? 'video/webm' : 'video/mp4';
        res.setHeader('Content-Type', contentType);

        const stream = fs.createReadStream(videoPath);
        stream.pipe(res);

        stream.on('error', (streamError) => {
            logger.error(`Stream error during download for job ${jobId} (${videoPath}): ${streamError.message}`);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to stream video file.' });
            }
        });
        stream.on('close', () => {
            logger.info(`Successfully streamed video for job ${jobId} from ${videoPath}`);
        });

    } catch (error) {
        logger.error(`Download error for job '${req.params.jobId}': ${error.message}`);
        if (error.message.toLowerCase().includes('video not available') ||
            error.message.toLowerCase().includes('not found') ||
            error.code === 'ENOENT') {
            return res.status(404).json({ error: 'Video not found or not ready.' });
        }
        res.status(500).json({
            error: 'Download failed',
            message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred.'
        });
    }
});

// Example: /api/models endpoint (adjust based on what Fal AI models you use)
app.get('/api/models', (req, res) => {
    res.json({
        textToVideo: [
            {
                id: 'fal-ai/ltx-video', // This is conceptual, frontend doesn't need to send model ID now
                name: 'LTX Video (via Fal AI)',
                description: 'High-quality text-to-video generation.',
                recommended: true
            }
        ],
        imageToVideo: [
            // Add if you integrate an image-to-video model from Fal AI
        ]
    });
});


// Comment out or remove image-to-video if not using with Fal AI for now
/*
app.post('/api/generate/image-to-video', generateLimiter, upload.single('image'), async (req, res) => {
    // ... Implementation for image-to-video using Fal AI if available ...
    logger.warn('Image-to-video endpoint called but not fully implemented with Fal AI yet.');
    res.status(501).json({ error: 'Image-to-video not implemented with current Fal AI model configuration.' });
});
*/

// Catch-all for non-API GET requests to serve index.html
app.get('*', (req, res, next) => {
    if (!req.path.startsWith('/api/') && req.accepts('html')) {
        res.sendFile(path.join(__dirname, '../frontend/public/index.html'), (err) => {
            if (err) {
                logger.error('Error sending index.html for path ' + req.path + ' :', err);
                next(err); // Pass to general error handler
            }
        });
    } else {
        next(); // Pass to 404 or other specific handlers
    }
});

// Error handling middleware (must be the last app.use() call before app.listen)
app.use((error, req, res, next) => {
    logger.error('Unhandled error caught by error-handling middleware:', {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : 'Stack hidden in production',
        url: req.originalUrl,
        method: req.method
    });
    if (res.headersSent) {
        return next(error); // Delegate to default Express error handler
    }
    res.status(error.status || 500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred. Please try again later.'
    });
});

// 404 Handler for any routes not matched above
app.use((req, res) => {
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
    if (req.accepts('json')) {
        res.status(404).json({ error: 'Not Found', message: `The requested resource ${req.originalUrl} was not found on this server.` });
    } else {
        res.status(404).type('text').send('Error 404: The page you are looking for cannot be found.');
    }
});

// Start server - THIS IS CRUCIAL AND MUST BE PRESENT AND ACTIVE
logger.info("Script execution reached end, attempting to start server...");
app.listen(PORT, () => {
    logger.info(`Neural Video Genesis Backend running on http://localhost:${PORT}`);
    logger.info(`Frontend should be accessible at http://localhost:${PORT}`);
    logger.info(`Fal AI API Key Loaded: ${!!process.env.FAL_KEY}`);
    logger.info(`OpenAI API Key Loaded (for prompt enhancement): ${!!process.env.OPENAI_API_KEY}`);
});

module.exports = app; // Optional: for testing frameworks