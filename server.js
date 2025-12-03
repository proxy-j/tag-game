// server.js - Node.js backend for multiplayer tag game
// Install dependencies: npm install express socket.io

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = 3000;
const PLAYER_SIZE = 15;
const NORMAL_SPEED = 3;
const TAGGER_SPEED = 3.75; // 1.25x faster
const FREEZE_TIME = 5000; // 5 seconds
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

let players = {};
let currentMap = 'plus';

// Map definitions
const maps = {
    plus: {
        name: 'Plus',
        walls: [
            // Horizontal bar
            { x: 460, y: 515, w: 1000, h: 50 },
            // Vertical bar
            { x: 935, y: 240, w: 50, h: 600 }
        ]
    },
    maze: {
        name: 'Maze',
        walls: [
            // Outer walls
            { x: 200, y: 200, w: 1520, h: 50 },
            { x: 200, y: 830, w: 1520, h: 50 },
            { x: 200, y: 200, w: 50, h: 680 },
            { x: 1670, y: 200, w: 50, h: 680 },
            // Internal maze walls
            { x: 400, y: 200, w: 50, h: 300 },
            { x: 600, y: 380, w: 50, h: 300 },
            { x: 800, y: 200, w: 50, h: 300 },
            { x: 1000, y: 380, w: 50, h: 300 },
            { x: 1200, y: 200, w: 50, h: 300 },
            { x: 1400, y: 380, w: 50, h: 300 }
        ]
    },
    corners: {
        name: 'Four Corners',
        walls: [
            // Top-left
            { x: 300, y: 250, w: 300, h: 50 },
            { x: 300, y: 250, w: 50, h: 300 },
            // Top-right
            { x: 1320, y: 250, w: 300, h: 50 },
            { x: 1570, y: 250, w: 50, h: 300 },
            // Bottom-left
            { x: 300, y: 780, w: 300, h: 50 },
            { x: 300, y: 530, w: 50, h: 300 },
            // Bottom-right
            { x: 1320, y: 780, w: 300, h: 50 },
            { x: 1570, y: 530, w: 50, h: 300 }
        ]
    },
    rooms: {
        name: 'Rooms',
        walls: [
            // Horizontal divider
            { x: 400, y: 515, w: 1120, h: 50 },
            // Vertical divider
            { x: 935, y: 240, w: 50, h: 600 },
            // Doorways (small gaps)
            // Top doorway already exists
            // Left doorway
            { x: 400, y: 515, w: 200, h: 50 },
            // Right doorway
            { x: 1120, y: 515, w: 200, h: 50 }
        ]
    },
    arena: {
        name: 'Arena',
        walls: [
            // Center obstacle
            { x: 860, y: 440, w: 200, h: 200 },
            // Corner blocks
            { x: 400, y: 300, w: 100, h: 100 },
            { x: 1420, y: 300, w: 100, h: 100 },
            { x: 400, y: 680, w: 100, h: 100 },
            { x: 1420, y: 680, w: 100, h: 100 }
        ]
    }
};

// Serve static files
app.use(express.static('public'));

// Generate random color
function randomColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', 
                    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Check collision with walls
function checkWallCollision(x, y) {
    const mapData = maps[currentMap];
    for (let wall of mapData.walls) {
        if (x + PLAYER_SIZE > wall.x && x - PLAYER_SIZE < wall.x + wall.w &&
            y + PLAYER_SIZE > wall.y && y - PLAYER_SIZE < wall.y + wall.h) {
            return true;
        }
    }
    return false;
}

// Check if players are touching
function checkCollision(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < PLAYER_SIZE * 2;
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join', (name) => {
        // If this is the first player, make them the tagger
        const isFirstPlayer = Object.keys(players).length === 0;
        
        players[socket.id] = {
            id: socket.id,
            name: name,
            x: Math.random() * (CANVAS_WIDTH - 200) + 100,
            y: Math.random() * (CANVAS_HEIGHT - 200) + 100,
            color: randomColor(),
            isTagger: isFirstPlayer,
            frozen: false,
            frozenUntil: 0,
            input: { up: false, down: false, left: false, right: false },
            map: maps[currentMap].name,
            walls: maps[currentMap].walls
        };
        
        // Send initial data to new player
        socket.emit('init', {
            id: socket.id,
            players: players
        });
        
        // Broadcast updated players to all
        io.emit('players', players);
        
        console.log(`${name} joined the game`);
    });
    
    socket.on('input', (input) => {
        if (players[socket.id]) {
            players[socket.id].input = input;
        }
    });
    
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            console.log(`${players[socket.id].name} left the game`);
            
            // If tagger left, assign new tagger
            if (players[socket.id].isTagger) {
                delete players[socket.id];
                const playerIds = Object.keys(players);
                if (playerIds.length > 0) {
                    const newTagger = playerIds[Math.floor(Math.random() * playerIds.length)];
                    players[newTagger].isTagger = true;
                    players[newTagger].frozen = false;
                }
            } else {
                delete players[socket.id];
            }
            
            io.emit('players', players);
        }
    });
});

// Game loop
setInterval(() => {
    const now = Date.now();
    
    // Update each player
    for (let id in players) {
        const p = players[id];
        
        // Check if frozen period is over
        if (p.frozen && now > p.frozenUntil) {
            p.frozen = false;
        }
        
        // Don't move if frozen
        if (p.frozen) continue;
        
        const speed = p.isTagger ? TAGGER_SPEED : NORMAL_SPEED;
        let newX = p.x;
        let newY = p.y;
        
        // Apply movement
        if (p.input.up) newY -= speed;
        if (p.input.down) newY += speed;
        if (p.input.left) newX -= speed;
        if (p.input.right) newX += speed;
        
        // Boundary checking
        newX = Math.max(PLAYER_SIZE, Math.min(CANVAS_WIDTH - PLAYER_SIZE, newX));
        newY = Math.max(PLAYER_SIZE, Math.min(CANVAS_HEIGHT - PLAYER_SIZE, newY));
        
        // Wall collision checking
        if (!checkWallCollision(newX, newY)) {
            p.x = newX;
            p.y = newY;
        }
        
        // Update map info
        p.map = maps[currentMap].name;
        p.walls = maps[currentMap].walls;
    }
    
    // Check for tags
    for (let id in players) {
        const tagger = players[id];
        if (!tagger.isTagger || tagger.frozen) continue;
        
        for (let otherId in players) {
            if (id === otherId) continue;
            const other = players[otherId];
            
            if (!other.frozen && checkCollision(tagger, other)) {
                // Tag successful!
                tagger.isTagger = false;
                tagger.frozen = true;
                tagger.frozenUntil = now + FREEZE_TIME;
                
                other.isTagger = true;
                other.frozen = false;
                
                console.log(`${tagger.name} tagged ${other.name}!`);
                break;
            }
        }
    }
    
    // Send updated game state
    io.emit('players', players);
    
}, 1000 / 60); // 60 FPS

// Change map every 2 minutes
setInterval(() => {
    const mapKeys = Object.keys(maps);
    let newMap;
    do {
        newMap = mapKeys[Math.floor(Math.random() * mapKeys.length)];
    } while (newMap === currentMap);
    
    currentMap = newMap;
    console.log(`Map changed to: ${maps[currentMap].name}`);
    
    // Reposition all players to avoid spawning in walls
    for (let id in players) {
        players[id].x = Math.random() * (CANVAS_WIDTH - 200) + 100;
        players[id].y = Math.random() * (CANVAS_HEIGHT - 200) + 100;
    }
}, 120000);

http.listen(PORT, () => {
    console.log(`Tag game server running on http://localhost:${PORT}`);
});
