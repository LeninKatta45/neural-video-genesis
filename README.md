# Neural Video Genesis 🌌🎬

Transform your imagination into stunning video reality! Neural Video Genesis is a full-stack application that allows you to generate unique videos from text prompts using cutting-edge AI models. It features a sleek, futuristic frontend and a robust Node.js backend that interfaces with AI video generation services.

Currently, this project is configured to use **Fal AI's LTX Video model** for text-to-video generation.

![Neural Video Genesis Screenshot](https://i.ibb.co/BDKcBdY/Neural-Video-Genesis.jpg)

## ✨ Features

*   **Text-to-Video Generation:** Input a descriptive prompt and watch your vision come to life.
*   **Intuitive Frontend:** A stylish, modern interface built with HTML, CSS, and JavaScript.
    *   Animated backgrounds, floating particles, and a neural grid aesthetic.
    *   Interactive controls for generation parameters.
    *   Real-time progress updates.
    *   Video preview and download of generated content.
*   **Robust Backend:**
    *   Built with Node.js and Express.js.
    *   Interfaces with [Fal AI](https://fal.ai/) for LTX Video generation.
    *   (Optional) OpenAI integration for AI-powered prompt enhancement.
    *   Asynchronous job processing for video generation.
    *   API endpoints for starting generation, checking job status, and downloading videos.
    *   Rate limiting for API protection.
*   **Customizable Parameters (Frontend):**
    *   Prompt Input
    *   Video Quality (mapped to inference steps)
    *   Style Intensity (mapped to guidance scale)
    *   *(Note: LTX Video model handles duration, frame rate, and motion dynamics implicitly based on the prompt and its internal logic.)*
*   **Logging:** Comprehensive logging using Winston for both backend operations and errors.

## 🛠️ Tech Stack

**Frontend:**
*   HTML5
*   CSS3 (with Google Fonts: Orbitron, Inter)
*   Vanilla JavaScript (ES6+)

**Backend:**
*   Node.js
*   Express.js
*   `@fal-ai/client` (for LTX Video generation)
*   `axios` (for OpenAI and potentially other HTTP requests)
*   `dotenv` (for environment variable management)
*   `winston` (for logging)
*   `multer` (for file uploads - placeholder for potential future image-to-video)
*   `express-rate-limit` (for API security)
*   `validator` (for input sanitization)

## 🚀 Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v16.0.0 or higher) and npm
*   Git
*   A [Fal AI](https://fal.ai/) account and API Key (`FAL_KEY`)
*   (Optional) An [OpenAI](https://openai.com/product) account and API Key (`OPENAI_API_KEY`) if you want to use the prompt enhancement feature.

### Setup Instructions

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/YOUR_USERNAME/neural-video-genesis.git
    cd neural-video-genesis
    ```
    *(Replace `YOUR_USERNAME` with your actual GitHub username.)*

2.  **Configure Backend Environment Variables:**
    *   Navigate to the `backend` directory:
        ```bash
        cd backend
        ```
    *   Create a `.env` file by copying the example (if you create one later) or making a new one:
        ```bash
        cp .env.example .env  # If you have an .env.example
        # OR create .env manually
        ```
    *   Open the `.env` file and add your API keys and configuration:
        ```env
        # API Keys
        FAL_KEY=your_actual_fal_api_key_here
        OPENAI_API_KEY=your_optional_openai_api_key_here

        # Server Configuration
        PORT=3000
        NODE_ENV=development # or production
        FRONTEND_URL=http://localhost:3000 # Should match the PORT

        # Logging
        LOG_LEVEL=info
        ```
        **IMPORTANT:** Replace placeholders with your actual keys. The `FAL_KEY` is essential for video generation.

3.  **Install Backend Dependencies:**
    *   Still in the `backend` directory:
        ```bash
        npm install
        ```

4.  **Run the Application:**
    *   Still in the `backend` directory:
        ```bash
        npm run dev
        ```
        This will start the backend server using `nodemon` (for auto-restarts on file changes). You should see logs indicating the server is running on `http://localhost:3000`.

5.  **Access the Frontend:**
    *   Open your web browser and navigate to:
        [http://localhost:3000](http://localhost:3000)

## 💡 How to Use

1.  **Open the Application:** Go to `http://localhost:3000` in your browser.
2.  **Enter Your Prompt:** In the "Creative Prompt" section, type a detailed description of the video you want to generate. Be specific about actions, subjects, environment, camera angles, and lighting for best results with LTX Video.
3.  **Adjust Parameters:**
    *   **Quality:** Influences the number of inference steps for the AI model. Higher quality generally means more processing time.
    *   **Style Intensity:** Adjusts the guidance scale, determining how closely the AI follows your prompt versus taking creative liberties.
    *   *(Other parameters like Duration and Frame Rate are present in the UI but have less direct impact on the LTX Video model which infers these from the prompt's detail and its internal settings.)*
4.  **Initialize Genesis:** Click the "Initialize Genesis" button.
5.  **Monitor Progress:** The "Neural Processing" section will appear, showing the status and progress of your video generation. You can also check the backend server logs for more detailed updates from Fal AI.
6.  **View and Download:** Once generation is complete, the "Generated Masterpiece" section will display your video. You can then download it.
7.  **New Genesis:** Click "New Genesis" to clear the results and start a new creation.

## 📝 API Endpoints (Backend)

The backend exposes the following API endpoints:

*   `GET /api/health`: Health check for the server.
*   `POST /api/generate/text-to-video`: Starts a new text-to-video generation job.
    *   Body (JSON): `{ "prompt": "your creative prompt", "quality": "1080p", "styleIntensity": 7 }`
*   `GET /api/job/:jobId/status`: Checks the status of a specific generation job.
*   `GET /api/download/:jobId`: Downloads the generated video for a completed job.
*   `GET /api/models`: Lists available models (currently configured for LTX Video).
