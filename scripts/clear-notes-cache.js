// Import required modules for ES modules
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Create equivalent of __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create the public directory if it doesn't exist
const publicDir = join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Create a timestamp to ensure the file is always new
const timestamp = new Date().getTime();

// Create a file that signals to the app to clear the notes cache
const cacheControlFile = join(publicDir, 'cache-control.json');

// Write the file with a command to clear notes cache
fs.writeFileSync(
  cacheControlFile,
  JSON.stringify({
    action: 'clear-notes-cache',
    timestamp: timestamp
  })
);

console.log('✅ Generated cache control file. Notes cache will be cleared on next app load.');