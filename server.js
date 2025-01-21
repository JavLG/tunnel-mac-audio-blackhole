const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const Throttle = require('throttle');

const streams = new Map();

app.use(express.static('public'));

// Stream endpoint
app.get("/stream", (req, res) => {
    const { id, stream } = generateStream();
    res.setHeader("Content-Type", "audio/mpeg");
    stream.pipe(res);
    res.on('close', () => { streams.delete(id) });
});

const generateStream = () => {
    const id = Math.random().toString(36).slice(2);
    const stream = new PassThrough();
    streams.set(id, stream);
    return { id, stream };
}

const broadcastToEveryStream = (chunk) => {
    for (let [id, stream] of streams) {
        stream.write(chunk);
    }
}

// Capture system audio using sox
const startAudioCapture = () => {
    const sox = spawn('sox', [
        '-d', // Use default audio device (BlackHole)
        '-t', 'mp3',
        '-', // Output to stdout
        'rate', '44100',
        'channels', '2'
    ]);

    const throttle = new Throttle(44100 * 2 * 2); // 44.1kHz, 16-bit, stereo
    sox.stdout.pipe(throttle);
    
    throttle.on('data', (chunk) => {
        broadcastToEveryStream(chunk);
    });

    sox.stderr.on('data', (data) => {
        console.error(`sox error: ${data}`);
    });
}

io.on('connection', (socket) => {
    console.log('Client connected');
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Start cloudflared tunnel
    const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`]);

    tunnel.stdout.on('data', (data) => {
        const output = data.toString();
    
        // cloudflare possible urls (cant remember which one you get with free tier)
        const urlPatterns = [
            /https:\/\/[^\s]+\.trycloudflare\.com/,
            /https:\/\/[^\s]+\.cloudflare\.run/,
            /https:\/\/[^\s]+\.tunnel\.cloudflare\.com/
        ];
    
        for (const pattern of urlPatterns) {
            const match = output.match(pattern);
            if (match) {
                console.log('\n🚀 Tunnel URL:', match[0], '\n');
                break;
            }
        }
    });
    
    tunnel.stderr.on('data', (data) => {
        console.error(`cloudflared error: ${data}`);
    });
    
    tunnel.on('exit', (code) => {
        console.log(`cloudflared process exited with code ${code}`);
    });

    startAudioCapture();
}); 