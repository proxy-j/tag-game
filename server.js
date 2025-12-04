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
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

let players = {};
let currentMap = 'plus';
let portals = [];

// Map definitions (using default dimensions, scaled per player)
const maps = {
    plus: {
        name: 'Plus',
        getWalls: (w, h) => [
            // Horizontal bar
            { x: w * 0.24, y: h * 0.477, w: w * 0.52, h: h * 0.046 },
            // Vertical bar
            { x: w * 0.487, y: h * 0.222, w: w * 0.026, h: h * 0.556 }
        ],
        portals: []
    },
    teleport: {
        name: 'Teleport',
        getWalls: (w, h) => [
            // Vertical divider in the middle
            { x: w * 0.487, y: h * 0.1, w: w * 0.026, h: h * 0.8 }
        ],
        getPortals: (w, h) => [
            // Top-left portal (goes to bottom-right)
            { x: w * 0.25, y: h * 0.25, radius: 40, target: 3 },
            // Top-right portal (goes to bottom-left)
            { x: w * 0.75, y: h * 0.25, radius: 40, target: 2 },
            // Bottom-left portal (goes to top-right)
            { x: w * 0.25, y: h * 0.75, radius: 40, target: 1 },
            // Bottom-right portal (goes to top-left)
            { x: w * 0.75, y: h * 0.75, radius: 40, target: 0 }
        ]
    },
    corners: {
        name: 'Four Corners',
        getWalls: (w, h) => [
            // Top-left
            { x: w * 0.156, y: h * 0.231, w: w * 0.156, h: h * 0.046 },
            { x: w * 0.156, y: h * 0.231, w: w * 0.026, h: h * 0.278 },
            // Top-right
            { x: w * 0.688, y: h * 0.231, w: w * 0.156, h: h * 0.046 },
            { x: w * 0.818, y: h * 0.231, w: w * 0.026, h: h * 0.278 },
            // Bottom-left
            { x: w * 0.156, y: h * 0.722, w: w * 0.156, h: h * 0.046 },
            { x: w * 0.156, y: h * 0.491, w: w * 0.026, h: h * 0.278 },
            // Bottom-right
            { x: w * 0.688, y: h * 0.722, w: w * 0.156, h: h * 0.046 },
            { x: w * 0.818, y: h * 0.491, w: w * 0.026, h: h * 0.278 }
        ],
        portals: []
    },
    arena: {
        name: 'Arena',
        getWalls: (w, h) => [
            // Center obstacle
            { x: w * 0.448, y: h * 0.407, w: w * 0.104, h: h * 0.185 },
            // Corner blocks
            { x: w * 0.208, y: h * 0.278, w: w * 0.052, h: h * 0.093 },
            { x: w * 0.740, y: h * 0.278, w: w * 0.052, h: h * 0.093 },
            { x: w * 0.208, y: h * 0.630, w: w * 0.052, h: h * 0.093 },
            { x: w * 0.740, y: h * 0.630, w: w * 0.052, h: h * 0.093 }
        ],
        portals: []
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

// Get walls for player's screen size
function getWallsForPlayer(playerId) {
    const p = players[playerId];
    if (!p) return [];
    return maps[currentMap].getWalls(p.screenWidth, p.screenHeight);
}

// Get portals for player's screen size
function getPortalsForPlayer(playerId) {
    const p = players[playerId];
    if (!p || !maps[currentMap].getPortals) return [];
    return maps[currentMap].getPortals(p.screenWidth, p.screenHeight);
}

// Check collision with walls for specific player
function checkWallCollision(x, y, playerId) {
    const walls = getWallsForPlayer(playerId);
    for (let wall of walls) {
        if (x + PLAYER_SIZE > wall.x && x - PLAYER_SIZE < wall.x + wall.w &&
            y + PLAYER_SIZE > wall.y && y - PLAYER_SIZE < wall.y + wall.h) {
            return true;
        }
    }
    return false;
}

// Find safe spawn position
function findSafeSpawn(playerId, screenWidth, screenHeight) {
    let x, y;
    let attempts = 0;
    const maxAttempts = 100;
    
    do {
        x = Math.random() * (screenWidth - 200) + 100;
        y = Math.random() * (screenHeight - 200) + 100;
        attempts++;
    } while (checkWallCollision(x, y, playerId) && attempts < maxAttempts);
    
    // If still in wall after max attempts, spawn in center
    if (checkWallCollision(x, y, playerId)) {
        x = screenWidth / 2;
        y = screenHeight / 2;
    }
    
    return { x, y };
}

// Check if players are touching (accounting for different screen sizes)
function checkCollision(p1, p2) {
    // Normalize positions to a common coordinate system
    const p1NormX = p1.x / p1.screenWidth;
    const p1NormY = p1.y / p1.screenHeight;
    const p2NormX = p2.x / p2.screenWidth;
    const p2NormY = p2.y / p2.screenHeight;
    
    // Calculate distance in normalized space
    const dx = (p1NormX - p2NormX) * Math.min(p1.screenWidth, p2.screenWidth);
    const dy = (p1NormY - p2NormY) * Math.min(p1.screenHeight, p2.screenHeight);
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    return distance < PLAYER_SIZE * 2;
}

// Check portal collision and teleport
function checkPortalCollision(player) {
    if (!maps[currentMap].getPortals) return;
    
    const portals = getPortalsForPlayer(player.id);
    for (let i = 0; i < portals.length; i++) {
        const portal = portals[i];
        const dx = player.x - portal.x;
        const dy = player.y - portal.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < portal.radius) {
            const targetPortal = portals[portal.target];
            player.x = targetPortal.x;
            player.y = targetPortal.y;
            return;
        }
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join', (data) => {
        const name = data.name;
        const screenWidth = data.screenWidth || DEFAULT_WIDTH;
        const screenHeight = data.screenHeight || DEFAULT_HEIGHT;
        
        // If this is the first player, make them the tagger
        const isFirstPlayer = Object.keys(players).length === 0;
        
        const spawnPos = findSafeSpawn(socket.id, screenWidth, screenHeight);
        
        players[socket.id] = {
            id: socket.id,
            name: name,
            x: spawnPos.x,
            y: spawnPos.y,
            color: randomColor(),
            isTagger: isFirstPlayer,
            frozen: false,
            frozenUntil: 0,
            input: { up: false, down: false, left: false, right: false },
            screenWidth: screenWidth,
            screenHeight: screenHeight,
            map: maps[currentMap].name,
            walls: getWallsForPlayer(socket.id)
        };
        
        // Send initial data to new player
        socket.emit('init', {
            id: socket.id,
            players: players,
            portals: getPortalsForPlayer(socket.id)
        });
        
        // Broadcast updated players to all
        broadcastPlayers();
        
        console.log(`${name} joined the game (${screenWidth}x${screenHeight})`);
    });
    
    socket.on('screenSize', (data) => {
        if (players[socket.id]) {
            players[socket.id].screenWidth = data.width;
            players[socket.id].screenHeight = data.height;
            
            // Update spawn if in wall
            if (checkWallCollision(players[socket.id].x, players[socket.id].y, socket.id)) {
                const spawnPos = findSafeSpawn(socket.id, data.width, data.height);
                players[socket.id].x = spawnPos.x;
                players[socket.id].y = spawnPos.y;
            }
        }
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
            
            broadcastPlayers();
        }
    });
});

// Broadcast players with their individual wall data
function broadcastPlayers() {
    for (let id in players) {
        io.to(id).emit('players', {
            players: players,
            portals: getPortalsForPlayer(id)
        });
    }
}

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
        newX = Math.max(PLAYER_SIZE, Math.min(p.screenWidth - PLAYER_SIZE, newX));
        newY = Math.max(PLAYER_SIZE, Math.min(p.screenHeight - PLAYER_SIZE, newY));
        
        // Wall collision checking
        if (!checkWallCollision(newX, newY, id)) {
            p.x = newX;
            p.y = newY;
        }
        
        // Portal collision checking
        checkPortalCollision(p);
        
        // Update map info
        p.map = maps[currentMap].name;
        p.walls = getWallsForPlayer(id);
    }
    
    // Check for tags
    for (let id in players) {
        const tagger = players[id];
        if (!tagger.isTagger || tagger.frozen) continue;
        
        for (let otherId in players) {
            if (id === otherId) continue;
            const other = players[otherId];
            
            if (!other.isTagger && !other.frozen && checkCollision(tagger, other)) {
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
    broadcastPlayers();
    
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
        const spawnPos = findSafeSpawn(id, players[id].screenWidth, players[id].screenHeight);
        players[id].x = spawnPos.x;
        players[id].y = spawnPos.y;
    }
}, 120000);

http.listen(PORT, () => {
    console.log(`Tag game server running on http://localhost:${PORT}`);
});
