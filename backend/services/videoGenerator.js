// neural-video-genesis/backend/services/videoGenerator.js
const { fal } = require('@fal-ai/client');
const axios = require('axios'); // Keep for OpenAI and downloading video
const fs = require('fs').promises;
const fsSync = require('fs'); // For synchronous operations like mkdirSync and createWriteStream
const path = require('path');
const { logger } = require('../utils/logger');

// Fal AI client will typically read FAL_KEY from environment variables.
// If you need to set it manually (e.g., in environments where env vars aren't easy):
// fal.config({
//   credentials: "YOUR_FAL_KEY_HERE_IF_NOT_IN_ENV" // Make sure this is your actual key
// });

const LTX_VIDEO_MODEL_ID = "fal-ai/ltx-video"; // The model identifier for LTX Video on Fal AI

class VideoGenerator {
    constructor(config) {
        this.openaiKey = config.openaiKey; // For prompt enhancement via OpenAI
        this.jobs = new Map(); // In-memory storage for job statuses (consider Redis/DB for production)
        this.outputDir = path.resolve('./generated'); // Absolute path to the 'generated' videos directory

        // Ensure the output directory exists upon instantiation
        if (!fsSync.existsSync(this.outputDir)) {
            fsSync.mkdirSync(this.outputDir, { recursive: true });
            logger.info(`Created output directory: ${this.outputDir}`);
        }
    }

    // Helper to map frontend quality setting to LTX's num_inference_steps
    mapQualityToSteps(quality) {
        switch (quality) {
            case '480p': return 20; // Fewer steps for a faster preview
            case '720p': return 30; // Standard quality
            case '1080p': return 40; // Higher quality, more steps
            // LTX Video might not directly support 4K resolution output via this param.
            // 'num_inference_steps' generally correlates with iteration quality.
            default: return 30; // Default to standard
        }
    }

    async generateFromText(options) {
        const {
            prompt,
            quality, // User's desired quality (e.g., '1080p', '720p')
            styleIntensity, // User's desired style intensity (1-10)
            jobId // Unique ID for this generation job
        } = options;

        // LTX Video specific parameters (duration, frameRate, motionDynamics from frontend
        // are not directly used by LTX video based on its documented input schema).

        try {
            this.updateJobStatus(jobId, { status: 'processing', progress: 0, message: 'Initializing LTX Video generation...' });

            let finalPrompt = prompt;
            if (this.openaiKey && prompt && prompt.trim() !== "") { // Check if prompt is valid for enhancement
                finalPrompt = await this.enhancePrompt(prompt, styleIntensity);
                this.updateJobStatus(jobId, { progress: 10, message: 'Prompt enhanced. Submitting to LTX Video...' });
            } else {
                this.updateJobStatus(jobId, { progress: 10, message: 'Submitting prompt to LTX Video...' });
            }

            const num_inference_steps = this.mapQualityToSteps(quality);
            // Map frontend 'styleIntensity' (1-10) to LTX 'guidance_scale' (typically 3-7 for LTX).
            // A simple linear mapping: 1 maps to 3, 10 maps to 7.
            const guidance_scale = 3 + (((parseInt(styleIntensity, 10) || 7) - 1) / 9) * 4;

            logger.info(`LTX Video generation for job ${jobId} with parameters:`, {
                promptLength: finalPrompt.length,
                num_inference_steps,
                guidance_scale: parseFloat(guidance_scale.toFixed(1)) // Ensure one decimal place
            });

            const result = await fal.subscribe(LTX_VIDEO_MODEL_ID, {
                input: {
                    prompt: finalPrompt,
                    // negative_prompt: "low quality, worst quality, ...", // Optional: Fal AI uses a default
                    num_inference_steps: num_inference_steps,
                    guidance_scale: parseFloat(guidance_scale.toFixed(1)),
                    // seed: Math.floor(Math.random() * 2**32), // Optional: for reproducibility, use a large integer
                },
                logs: true, // Request logs from Fal AI for progress updates
                onQueueUpdate: (update) => {
                    let currentProgress = this.jobs.get(jobId)?.progress || 20; // Start progress after initial setup

                    if (update.status === "IN_PROGRESS" || update.status === "COMPLETED") {
                        if (update.logs && update.logs.length > 0) {
                            const lastLogEntry = update.logs[update.logs.length - 1];
                            const logMessage = lastLogEntry.message || `Status: ${update.status}`;
                            // Attempt to parse progress percentage from Fal's logs
                            const progressMatch = logMessage.match(/(\d+)\s*%/); // Looks for "X%"
                            const stepMatch = logMessage.match(/(\d+)\s*\/\s*(\d+)/); // Looks for "X/Y"

                            if (stepMatch) { // "X/Y steps"
                                currentProgress = Math.min(90, 20 + (parseInt(stepMatch[1]) / parseInt(stepMatch[2])) * 70);
                            } else if (progressMatch) { // "X%"
                                currentProgress = Math.min(90, 20 + parseInt(progressMatch[1]) * 0.7);
                            }
                            this.updateJobStatus(jobId, {
                                progress: Math.round(currentProgress),
                                message: `Processing: ${logMessage}`
                            });
                        } else {
                            // If no specific logs, make a small progress increment
                            this.updateJobStatus(jobId, {
                                progress: Math.round(currentProgress < 80 ? currentProgress + 2 : currentProgress),
                                message: `LTX Video Status: ${update.status}`
                            });
                        }
                    } else if (update.status === "ERROR") {
                        const errorMessage = (update.error && update.error.message) ? update.error.message : 'Unknown error from Fal AI during queue update.';
                        this.updateJobStatus(jobId, {
                            status: 'failed',
                            progress: currentProgress,
                            message: `LTX Video Error: ${errorMessage}`,
                            error: errorMessage
                        });
                    }
                },
            });

            // `fal.subscribe` resolves when the job is COMPLETED or if an unrecoverable ERROR occurs.
            // Check the structure of the successful result based on Fal AI's LTX Video output schema.
            if (result && result.data && result.data.video && result.data.video.url) {
                this.updateJobStatus(jobId, { progress: 90, message: 'Video generated. Downloading from Fal AI...' });

                const videoContentType = result.data.video.content_type || 'application/octet-stream';
                const videoPath = await this.downloadVideo(result.data.video.url, jobId, videoContentType);

                this.updateJobStatus(jobId, {
                    status: 'completed',
                    progress: 100,
                    message: 'Video generation completed successfully!',
                    videoUrl: `/api/download/${jobId}`, // Relative URL for the client
                    videoPath, // Full server path to the downloaded file
                    seed: result.data.seed // LTX Video output schema includes a seed
                });
                return { jobId, videoPath, status: 'completed' };
            } else {
                // Handle cases where Fal AI call completed but the result structure is not as expected
                // or an error object is returned by fal.subscribe itself.
                logger.error(`LTX Video generation returned unexpected result structure or error for job ${jobId}:`, result);
                const falErrorDetail = (result && result.error && result.error.message) ? result.error.message :
                                     (result && result.detail) ? result.detail : // Some Fal errors might use 'detail'
                                     'Fal AI call completed, but video data is missing or malformed.';
                this.updateJobStatus(jobId, {
                    status: 'failed',
                    progress: this.jobs.get(jobId)?.progress || 85, // Mark some progress as Fal call finished
                    message: `Generation Post-processing Failed: ${falErrorDetail}`,
                    error: falErrorDetail
                });
                throw new Error(`LTX Video generation post-processing failed: ${falErrorDetail}`);
            }

        } catch (error) {
            // This catches errors from `fal.subscribe` itself (e.g., network issues, auth problems)
            // or errors thrown within the try block (e.g., by enhancePrompt, downloadVideo).
            logger.error(`Overall video generation error for job ${jobId}:`, error);
            this.updateJobStatus(jobId, {
                status: 'failed',
                progress: this.jobs.get(jobId)?.progress || 0,
                message: `Generation failed: ${error.message}`,
                error: error.message
            });
            throw error; // Re-throw to be caught by the route handler if necessary
        }
    }

    async enhancePrompt(originalPrompt, styleIntensity) {
        if (!this.openaiKey) {
            logger.info('OpenAI API key not provided. Skipping prompt enhancement.');
            return originalPrompt;
        }
        if (!originalPrompt || originalPrompt.trim() === "") {
            logger.warn('Empty prompt provided for enhancement. Skipping.');
            return originalPrompt;
        }

        logger.info(`Enhancing prompt for LTX Video with style intensity: ${styleIntensity}`);
        try {
            const intensityMap = {
                1: "subtle and realistic", 2: "slightly stylized", 3: "moderately artistic",
                4: "noticeably creative", 5: "distinctly stylized", 6: "highly artistic",
                7: "dramatically enhanced", 8: "intensely cinematic", 9: "extremely stylized",
                10: "maximum artistic interpretation, highly detailed, and visually rich"
            };
            const systemMessage = `You are an expert creative assistant transforming user text prompts into vivid, cinematic prompts for the LTX AI video generation model. LTX prefers prompts that are a single flowing paragraph (max 200 words) structured like a shot list: 1. Start with main action. 2. Add specific movements/gestures. 3. Describe character/object appearances. 4. Include background/environment. 5. Specify camera angles/movements. 6. Describe lighting/colors. 7. Note changes/sudden events. The style intensity should be: "${intensityMap[styleIntensity] || 'moderately artistic'}". Focus on literal and precise descriptions. Output ONLY the enhanced prompt paragraph.`;

            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-3.5-turbo', // Or 'gpt-4o-mini' or other cost-effective model
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: `Original prompt for LTX: "${originalPrompt}"` }
                ],
                max_tokens: 280, // Allow slightly more tokens for detailed LTX prompts
                temperature: 0.7 // Good balance of creativity and adherence
            }, {
                headers: {
                    'Authorization': `Bearer ${this.openaiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const enhanced = response.data.choices[0].message.content.trim();
            logger.info(`Original prompt: "${originalPrompt}" \nEnhanced for LTX: "${enhanced}"`);
            return enhanced;
        } catch (error) {
            const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            logger.warn(`OpenAI prompt enhancement failed, using original prompt. Error: ${errorMessage}`);
            return originalPrompt;
        }
    }

    async downloadVideo(videoUrl, jobId, contentType = 'video/mp4') {
        try {
            let extension = 'mp4'; // Sensible default
            if (contentType) {
                const type = contentType.toLowerCase();
                if (type.includes('mp4')) extension = 'mp4';
                else if (type.includes('webm')) extension = 'webm';
                else if (type.includes('mov') || type.includes('quicktime')) extension = 'mov';
                else if (type.includes('octet-stream')) {
                    // For 'application/octet-stream', LTX Video seems to provide .mp4 files.
                    // If Fal provides file_name in result.data.video.file_name, we could use its extension.
                    // For now, assuming .mp4 if it's octet-stream from Fal video service.
                    extension = 'mp4';
                    logger.info(`Received content type '${contentType}', assuming .${extension} for job ${jobId}`);
                } else {
                    const parts = type.split('/');
                    if (parts.length > 1 && parts[1]) {
                        extension = parts[1].split(';')[0].trim(); // e.g., 'video/x-matroska' -> 'x-matroska' (mkv)
                        if (extension === 'x-matroska') extension = 'mkv';
                    }
                }
            }

            const outputPath = path.join(this.outputDir, `${jobId}.${extension}`);
            logger.info(`Attempting to download LTX video for job ${jobId} from ${videoUrl} to ${outputPath} (Content-Type: ${contentType})`);

            const response = await axios({
                method: 'GET',
                url: videoUrl,
                responseType: 'stream'
            });

            const writer = fsSync.createWriteStream(outputPath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    logger.info(`Video successfully downloaded for job ${jobId} to ${outputPath}`);
                    resolve(outputPath);
                });
                writer.on('error', (err) => {
                    logger.error(`Failed to write video to disk for job ${jobId} (${outputPath}):`, err);
                    reject(err); // This will propagate to the calling function's catch block
                });
            });
        } catch (error) {
            logger.error(`Failed to download video from URL ${videoUrl} for job ${jobId}:`, error);
            throw new Error(`Failed to download generated video from Fal AI: ${error.message}`);
        }
    }

    updateJobStatus(jobId, newStatus) {
        const existingJob = this.jobs.get(jobId) || { progress: 0, message: 'Initializing...' }; // Ensure existingJob is an object
        const updatedJob = {
            ...existingJob,
            ...newStatus,
            jobId: jobId, // Ensure jobId is always part of the status
            updatedAt: new Date().toISOString()
        };
        this.jobs.set(jobId, updatedJob);
        logger.info(`Job ${jobId} status: ${updatedJob.status || 'processing'}, Progress: ${updatedJob.progress}%, Msg: "${updatedJob.message}"`);
    }

    async getJobStatus(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            // Check if a file exists from a previous run (useful for development)
            const potentialPathBase = path.join(this.outputDir, `${jobId}`);
            const commonExtensions = ['.mp4', '.webm', '.mov', '.mkv'];
            for (const ext of commonExtensions) {
                const fullPath = potentialPathBase + ext;
                try {
                    await fs.access(fullPath); // Check if file exists and is accessible
                    logger.info(`Job ${jobId} not in active memory, but file ${fullPath} found on disk.`);
                    // Construct a 'completed' job status object for this found file
                    return {
                        jobId,
                        status: 'completed',
                        progress: 100,
                        message: 'Video found from a previous session (file on disk).',
                        videoUrl: `/api/download/${jobId}`, // Client will use this to trigger download
                        videoPath: fullPath,                 // Server uses this for the actual file
                        updatedAt: (await fs.stat(fullPath)).mtime.toISOString() // Use file modification time
                    };
                } catch (error) {/* File not found with this extension, try next */}
            }
            logger.warn(`Job ${jobId} not found in memory or on disk with common extensions.`);
            throw new Error('Job not found');
        }
        return job;
    }

    async getVideoPath(jobId) {
        const job = await this.getJobStatus(jobId); // This might retrieve from disk if not in memory
        if (!job || job.status !== 'completed' || !job.videoPath) {
            logger.warn(`Video path not available or job not complete for job ${jobId}. Status: ${job ? job.status : 'N/A'}`);
            throw new Error('Video not available or generation not complete.');
        }
        // Ensure the path is absolute for fs.access, though resolve in constructor should handle it.
        const absoluteVideoPath = path.resolve(job.videoPath);
        try {
            await fs.access(absoluteVideoPath); // Verify file still exists and is accessible
            return absoluteVideoPath;
        } catch (error) {
            logger.error(`File access error for stored video path ${absoluteVideoPath} (job ${jobId}): ${error.message}`);
            throw new Error('Video file (previously marked complete) not found on server or is inaccessible.');
        }
    }

    // LTX Video schema focuses on text-to-video. If Fal AI offers a separate image-to-video model,
    // a similar method `generateFromImage` would be created for that model ID.
    // For now, this is commented out.
    /*
    async generateFromImage(options) {
        // Implementation for an image-to-video model on Fal AI would go here
        // similar to generateFromText, but using the specific model ID and input schema.
        logger.warn("generateFromImage called but not implemented for current LTX Video configuration.");
        throw new Error("Image-to-video functionality is not implemented for this model.");
    }
    */
}

module.exports = VideoGenerator;