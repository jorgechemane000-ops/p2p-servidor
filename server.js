/*
 * server.js — Servidor de Sinalização + hospeda a página web do celular
 *
 * Ele NÃO transfere seus arquivos. Ele só serve de "telefonista":
 * ajuda os dois lados a trocarem os dados de rede necessários para
 * abrirem uma conexão direta (P2P) entre si.
 *
 * Também serve a pasta "public/" como página web — é o que permite
 * abrir o Sinapse pelo navegador do celular, sem instalar nada,
 * usando exatamente o mesmo código de sala do app do Windows.
 */

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const servidorHttp = http.createServer(app);
const io = new Server(servidorHttp, {
  cors: { origin: '*' }
});

// Tudo dentro de public/ (a página do celular, o ícone) fica disponível
// direto pela URL do Render — por exemplo, public/index.html vira a
// própria página inicial.
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('[+] Dispositivo conectado:', socket.id);

  // --- Entrar numa sala ---------------------------------------------------
  socket.on('join-room', (roomId) => {
    const sala = io.sockets.adapter.rooms.get(roomId);
    const quantidade = sala ? sala.size : 0;

    // Só permitimos 2 pessoas por sala (um envia, outro recebe) — não
    // importa se são dois PCs, um PC e um celular, ou dois celulares.
    if (quantidade >= 2) {
      socket.emit('room-full');
      console.log(`[!] Sala "${roomId}" cheia. Recusado: ${socket.id}`);
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    // Quem chega primeiro (sala vazia) será o INICIADOR da conexão P2P.
    // Isso evita que os dois tentem iniciar ao mesmo tempo e a conexão falhe.
    const isInitiator = quantidade === 0;
    socket.emit('joined', { isInitiator, roomId });

    console.log(`[>] ${socket.id} entrou na sala "${roomId}" como ${isInitiator ? 'INICIADOR' : 'CONVIDADO'}`);

    // Avisa a outra pessoa que alguém entrou
    socket.to(roomId).emit('user-connected');
  });

  // --- Repassar sinais de conexão (SDP e candidatos ICE) ------------------
  socket.on('signal', (data) => {
    if (!data || !data.roomId) return;
    socket.to(data.roomId).emit('signal', data.signal);
  });

  // --- Saída --------------------------------------------------------------
  socket.on('disconnect', () => {
    console.log('[-] Dispositivo desconectado:', socket.id);
    if (socket.data.roomId) {
      socket.to(socket.data.roomId).emit('user-disconnected');
    }
  });
});

// O Render informa a porta certa pela variável de ambiente PORT; 3000 só
// é usado quando testado localmente no seu PC.
const PORTA = process.env.PORT || 3000;

servidorHttp.listen(PORTA, () => {
  console.log(`Servidor de sinalização (e página web) rodando na porta ${PORTA}`);
  console.log('Deixe esta janela aberta enquanto estiver testando. Ctrl+C para parar.');
});
