/*
 * server.js — Servidor de Sinalização
 *
 * Ele NÃO transfere seus arquivos. Ele só serve de "telefonista":
 * ajuda os dois programas a trocarem os dados de rede necessários
 * para abrirem uma conexão direta (P2P) entre si.
 *
 * Rodar com:  npm run server
 */

const PORTA = 3000;

const io = require('socket.io')(PORTA, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  console.log('[+] Dispositivo conectado:', socket.id);

  // --- Entrar numa sala ---------------------------------------------------
  socket.on('join-room', (roomId) => {
    const sala = io.sockets.adapter.rooms.get(roomId);
    const quantidade = sala ? sala.size : 0;

    // Só permitimos 2 pessoas por sala (um envia, outro recebe)
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

console.log(`Servidor de sinalização rodando em http://localhost:${PORTA}`);
console.log('Deixe esta janela aberta enquanto estiver testando. Ctrl+C para parar.');
