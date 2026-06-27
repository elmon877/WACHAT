const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const loki = require('lokijs');

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
    chatCollection = db.getCollection('chats');
    if (!chatCollection) chatCollection = db.addCollection('chats');

    statusCollection = db.getCollection('statuses');
    if (!statusCollection) statusCollection = db.addCollection('statuses');

    console.log('✅ Database siap.');
}

// ==========================================
// STATIC FILES — taruh index.html di folder /public
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
    userOnline++;
    io.emit('online-count', userOnline);
    console.log(`[+] User terhubung. Online: ${userOnline}`);

    // -----------------------------------------
    // DAFTAR — simpan info user di socket
    // (dikirim HTML saat connect, baris: socket.emit('daftar', ...))
    // -----------------------------------------
    socket.on('daftar', (data) => {
        socket.userNama = data.nama;
        socket.userNomor = data.nomor;
        console.log(`[daftar] ${data.nama} (${data.nomor})`);

        // Kirim daftar status terkini ke user yang baru masuk
        // ⚠️ Event 'update-status' — sesuai listener di HTML
        if (statusCollection) {
            const daftarStatus = statusCollection
                .chain()
                .simplesort('$loki', { desc: true })
                .limit(20)
                .data();
            socket.emit('update-status', daftarStatus);
        }
    });

    // -----------------------------------------
    // JOIN ROOM
    // HTML mengirim: socket.emit('join-room', { roomId, nama })
    // Server memasukkan socket ke room tertentu,
    // lalu kirim riwayat 100 pesan terakhir di room itu.
    // -----------------------------------------
    socket.on('join-room', (data) => {
        const { roomId, nama } = data;

        // Tinggalkan semua room sebelumnya (selain room default socket.id)
        Object.keys(socket.rooms).forEach(r => {
            if (r !== socket.id) socket.leave(r);
        });

        socket.join(roomId);
        socket.currentRoom = roomId;
        console.log(`[join-room] ${nama} masuk room: ${roomId}`);

        // Kirim riwayat khusus room ini ke pemanggil saja
        if (chatCollection) {
            const riwayat = chatCollection
                .chain()
                .find({ roomId: roomId })
                .simplesort('$loki', { desc: false })
                .limit(100)
                .data();
            socket.emit('muat-riwayat', riwayat);
        }
    });

    // -----------------------------------------
    // KIRIM PESAN (teks + file/gambar/video)
    // HTML mengirim: socket.emit('kirim-pesan', data)
    // data = { roomId, nama, nomor, pesan, waktu, replyTo?, msg? }
    //   msg = { fileData, fileType } jika ada lampiran
    // -----------------------------------------
    socket.on('kirim-pesan', (data) => {
        if (!data.roomId) return;

        // Simpan ke DB (kecuali fileData agar DB tidak bengkak —
        // jika ingin simpan gambar, hapus baris filter di bawah)
        if (chatCollection) {
            const simpan = { ...data };
            if (simpan.msg && simpan.msg.fileData && simpan.msg.fileData.length > 500000) {
                // File > ~375KB tidak disimpan ke DB (opsional, bisa dihapus)
                simpan.msg = { fileType: simpan.msg.fileType, fileData: '' };
            }
            chatCollection.insert(simpan);
        }

        // Siarkan ke semua socket di room yang sama
        io.to(data.roomId).emit('terima-pesan', data);
    });

    // -----------------------------------------
    // BUAT STATUS
    // HTML mengirim: socket.emit('buat-status', statusObj)
    // Server simpan & broadcast 'update-status' (bukan 'update-list-status')
    // agar cocok dengan listener di HTML: socket.on('update-status', ...)
    // -----------------------------------------
    socket.on('buat-status', (statusBaru) => {
        if (statusCollection) {
            statusCollection.insert(statusBaru);
        }
        const daftarStatus = statusCollection
            .chain()
            .simplesort('$loki', { desc: true })
            .limit(20)
            .data();

        // ⚠️  Nama event HARUS 'update-status' — sesuai HTML
        io.emit('update-status', daftarStatus);
    });

    // -----------------------------------------
    // INDIKATOR MENGETIK
    // HTML: socket.emit('sedang-mengetik', { roomId, nama })
    // Broadcast hanya ke room yang sama, kecuali pengirim
    // -----------------------------------------
    socket.on('sedang-mengetik', (data) => {
        if (data.roomId) {
            socket.to(data.roomId).emit('user-mengetik', data);
        }
    });

    socket.on('berhenti-mengetik', (data) => {
        const roomId = (data && data.roomId) || socket.currentRoom;
        if (roomId) {
            socket.to(roomId).emit('user-berhenti');
        }
    });

    // -----------------------------------------
    // DISCONNECT
    // -----------------------------------------
    socket.on('disconnect', () => {
        userOnline--;
        if (userOnline < 0) userOnline = 0;
        io.emit('online-count', userOnline);
        console.log(`[-] User terputus. Online: ${userOnline}`);
    });
});

// ==========================================
// JALANKAN SERVER
// ==========================================
server.listen(PORT, () => {
    console.log('==================================================');
    console.log(`  Elmon Chat Server berjalan!`);
    console.log(`  Buka: http://localhost:${PORT}`);
    console.log('==================================================');
});