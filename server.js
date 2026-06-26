const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const loki = require('lokijs'); // Database lokal ringan agar data permanen

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
let userOnline = 0;

// ==========================================
// CONFIG DATABASE (LokiJS)
// ==========================================
const db = new loki('database.json', {
    autoload: true,
    autoloadCallback: databaseInitialize,
    autosave: true, 
    autosaveInterval: 4000
});

let chatCollection;
let statusCollection;

function databaseInitialize() {
    chatCollection = db.getCollection("chats");
    if (chatCollection === null) {
        chatCollection = db.addCollection("chats");
    }
    
    statusCollection = db.getCollection("statuses");
    if (statusCollection === null) {
        statusCollection = db.addCollection("statuses");
    }
    console.log("Database siap digunakan secara permanen.");
}

// Menghubungkan Express ke folder tempat index.html berada
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// LOGIKA UTAMA SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
    userOnline++;
    io.emit('online-count', userOnline);
    console.log(`User terhubung. Total Online: ${userOnline}`);

    // Kirim data riwayat dari database saat user baru terhubung
    if (chatCollection && statusCollection) {
        const riwayatChat = chatCollection.chain().simplesort('$loki', {desc: false}).limit(100).data();
        const daftarStatus = statusCollection.chain().simplesort('$loki', {desc: true}).limit(20).data();
        
        socket.emit('muat-riwayat', riwayatChat);
        socket.emit('update-list-status', daftarStatus);
    }

    // Menangani pengiriman pesan baru (Teks atau Gambar)
    socket.on('kirim-pesan', (data) => {
        if (chatCollection) {
            chatCollection.insert(data); // Simpan ke file database
        }
        io.emit('terima-pesan', data); // Siarkan ke semua orang
    });

    // Menangani pembuatan status baru ala WA
    socket.on('buat-status', (statusBaru) => {
        if (statusCollection) {
            statusCollection.insert(statusBaru); // Simpan status ke DB
        }
        const daftarStatus = statusCollection.chain().simplesort('$loki', {desc: true}).limit(20).data();
        io.emit('update-list-status', daftarStatus); // Kirim ke semua user yang online
    });

    // Menangani indikator pengetikan
    socket.on('sedang-mengetik', (data) => {
        socket.broadcast.emit('user-mengetik', data);
    });

    socket.on('berhenti-mengetik', () => {
        socket.broadcast.emit('user-berhenti');
    });

    socket.on('disconnect', () => {
        userOnline--;
        if (userOnline < 0) userOnline = 0;
        io.emit('online-count', userOnline);
        console.log(`User terputus. Total Online: ${userOnline}`);
    });
});

// Menjalankan server aplikasi
server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`  Server ELmon Clone Berjalan Online secara Lokal!`);
    console.log(`  Buka browser Anda di: http://localhost:${PORT}`);
    console.log(`==================================================`);
});