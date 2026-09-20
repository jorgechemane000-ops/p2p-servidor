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

// --- Credenciais TURN temporárias -----------------------------------------
// Em vez de um usuário/senha fixos escritos dentro do app (que qualquer
// pessoa pode extrair do .exe e usar para sempre), o app pede uma credencial
// nova aqui toda vez que vai conectar. Essa credencial expira sozinha depois
// de algumas horas — se alguém conseguir "roubar" uma, ela já não serve pra
// muita coisa. A chave secreta da Metered.ca fica só aqui no servidor,
// numa variável de ambiente do Render — nunca é enviada para o app.
const METERED_APP_NAME = process.env.METERED_APP_NAME;
const METERED_SECRET_KEY = process.env.METERED_SECRET_KEY;
const EXPIRACAO_CREDENCIAL_SEGUNDOS = 4 * 60 * 60; // 4 horas — de sobra para uma sessão de uso
const STUN_PADRAO = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

app.get('/turn-credentials', async (req, res) => {
  // Sem as duas variáveis configuradas no Render, respondemos só com STUN
  // (sem TURN) — a conexão direta continua funcionando normalmente; só a
  // opção de retransmissor fica indisponível até isso ser configurado.
  if (!METERED_APP_NAME || !METERED_SECRET_KEY) {
    console.log('[!] METERED_APP_NAME/METERED_SECRET_KEY não configurados — respondendo sem TURN.');
    return res.json({ iceServers: STUN_PADRAO });
  }

  try {
    const resposta = await fetch(
      `https://${METERED_APP_NAME}.metered.live/api/v1/turn/credential?secretKey=${encodeURIComponent(METERED_SECRET_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiryInSeconds: EXPIRACAO_CREDENCIAL_SEGUNDOS,
          label: 'sinapse-' + Date.now()
        })
      }
    );

    if (!resposta.ok) throw new Error('Metered respondeu HTTP ' + resposta.status);
    const dados = await resposta.json();

    res.json({
      iceServers: [
        ...STUN_PADRAO,
        { urls: 'turn:global.relay.metered.ca:80', username: dados.username, credential: dados.password },
        { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: dados.username, credential: dados.password },
        { urls: 'turn:global.relay.metered.ca:443', username: dados.username, credential: dados.password },
        { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: dados.username, credential: dados.password }
      ]
    });
  } catch (erro) {
    console.error('[!] Erro ao gerar credencial TURN:', erro.message);
    // Mesmo se a Metered falhar, devolve algo utilizável (só STUN) em vez
    // de travar a conexão do app inteiro por causa disso.
    res.json({ iceServers: STUN_PADRAO });
  }
});

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
