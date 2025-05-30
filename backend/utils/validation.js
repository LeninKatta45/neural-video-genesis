const validator = require('validator');

function validatePrompt(prompt) {
    const errors = [];
    
    if (!prompt || typeof prompt !== 'string') {
        errors.push('Prompt is required and must be a string');
    } else {
        if (prompt.trim().length < 10) {
            errors.push('Prompt must be at least 10 characters long');
        }
        if (prompt.length > 2000) {
            errors.push('Prompt must be less than 2000 characters');
        }
        
        // Check for potentially harmful content
        const harmfulPatterns = [
            /violence|gore|blood/i,
            /nsfw|adult|explicit/i,
            /hate|discrimination/i
        ];
        
        if (harmfulPatterns.some(pattern => pattern.test(prompt))) {
            errors.push('Prompt contains inappropriate content');
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    
    // Using validator.escape to prevent XSS. Trim whitespace.
    return validator.escape(input.trim());
}

module.exports = {
    validatePrompt,
    sanitizeInput
};