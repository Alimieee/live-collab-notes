require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// ------------------------------------------------
// ☁️ NEW: THE CLOUD DATABASE (MongoDB)
// ------------------------------------------------
const { MongoClient } = require('mongodb');

// ⚠️ IMPORTANT: Replace <db_password> with your actual password!
// Make sure you keep the quotes around the whole link.
const uri = process.env.MONGODB_URI;

if (!uri) {
    console.error("❌ CRITICAL ERROR: Could not find MONGODB_URI in your .env file!");
    process.exit(1); // Stops the server so you can fix it
}

const client = new MongoClient(uri);
let roomsCollection; // This will hold our specific database folder
let roomDocuments = {}; // We keep a quick RAM memory so typing stays lightning fast!

// Connect to the Cloud Warehouse when the server turns on
async function connectDB() {
    try {
        await client.connect();
        console.log("☁️ Connected to MongoDB Cloud Warehouse!");

        // Create a database called 'collab_notes' and a folder inside it called 'rooms'
        const db = client.db("collab_notes");
        roomsCollection = db.collection("rooms");

        // Download all existing rooms from the cloud into our quick memory
        const allRooms = await roomsCollection.find({}).toArray();
        allRooms.forEach(room => {
            roomDocuments[room.roomName] = room.content;
        });
        console.log("📂 Cloud data loaded successfully!");
    } catch (err) {
        console.error("Database connection failed:", err);
    }
}
connectDB();

// ------------------------------------------------
// 🚪 THE FRONT DOOR (This fixes your Cannot GET / error!)
// ------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});


io.on('connection', (socket) => {

    //The moment someone connects, send them a list of all existing rooms!
    socket.emit('available-rooms', Object.keys(roomDocuments));

    // ------------------------------------------------
    // 🚪 DOOR 1: STRICTLY FOR CREATING NEW ROOMS
    // ------------------------------------------------
    socket.on('create-room', async (requestData) => {
        const roomName = requestData.roomName;
        const password = requestData.password || "";

        // Ask MongoDB if this room exists
        const existingRoom = await roomsCollection.findOne({ roomName: roomName });

        if (existingRoom) {
            // 🛑 THE NEW ERROR: The room is already taken!
            socket.emit('join-error', 'That room name is already taken! Please choose another.');
        } else {
            // ✅ Safe to create! 
            roomDocuments[roomName] = "";
            await roomsCollection.insertOne({
                roomName: roomName,
                content: "",
                password: password
            });
            io.emit('new-room-created', roomName);

            // Let the creator inside
            socket.join(roomName);
            socket.room = roomName;
            console.log(`🟢 New Room Created: ${roomName}`);

            socket.emit('join-success', roomName);
            socket.emit('receive-update', roomDocuments[roomName]);
        }
    });

    // ------------------------------------------------
    // 🚪 DOOR 2: STRICTLY FOR JOINING EXISTING ROOMS
    // ------------------------------------------------
    socket.on('join-room', async (requestData) => {
        const roomName = requestData.roomName;
        const password = requestData.password || "";

        // Ask MongoDB if this room exists
        const existingRoom = await roomsCollection.findOne({ roomName: roomName });

        if (existingRoom) {
            // Room exists! Now check the password...
            const dbPassword = existingRoom.password || "";

            if (dbPassword !== password) {
                socket.emit('join-error', 'Incorrect PIN code!');
                return; // Kick them out
            }

            // ✅ Password matches! Let them in.
            socket.join(roomName);
            socket.room = roomName;
            console.log(`🟢 Access Granted to room: ${roomName}`);

            socket.emit('join-success', roomName);
            socket.emit('receive-update', roomDocuments[roomName]);
        } else {
            // 🛑 ERROR: They clicked a green button for a room that doesn't exist anymore!
            socket.emit('join-error', 'This room no longer exists in the database!');
        }
    });

    // 2. TYPING: Update the specific room's memory
    socket.on('send-typing', async (textData) => { // <-- Notice the 'async' word!
        roomDocuments[socket.room] = textData;
        socket.to(socket.room).emit('receive-update', textData);

        // ☁️ CLOUD TRIGGER: Send the new text to this specific room in the Cloud!
        await roomsCollection.updateOne(
            { roomName: socket.room },
            { $set: { content: textData } }
        );
    });

    // 3. MOUSE TRACKING: Only broadcast to the same room
    socket.on('mouse-move', (cursorData) => {
        socket.to(socket.room).emit('user-mouse-moved', cursorData);
    });

    // 4. TYPING INDICATORS
    socket.on('typing', () => {
        socket.to(socket.room).emit('user-is-typing');
    });

    socket.on('stopped-typing', () => {
        socket.to(socket.room).emit('user-stopped-typing');
    });

    socket.on('disconnect', () => {
        console.log('🔴 A user disconnected.');
    });
});

// ------------------------------------------------
// 🚀 START THE ENGINE
// ------------------------------------------------
// Cloud servers assign a random PORT. If we are local, use 3000.
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});