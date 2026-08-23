const express = require("express");

const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = new Map();

const PATH_LENGTH = 52;
const FINISH = 56;
const HOME = -1;

const COLORS = ["red", "blue"];

function createRoomCode() {
    let code;

    do {
        code = Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase();
    } while (rooms.has(code));

    return code;
}

function createPlayer(socket, name, color) {
    return {
        socketId: socket.id,
        name: name || "بازیکن",
        color,
        pieces: [HOME, HOME, HOME, HOME]
    };
}

function send(socket, type, data = {}) {
    if (socket && socket.connected) {
        socket.emit(type, data);
    }
}

function broadcast(room, type, data = {}) {
    room.players.forEach(player => {
        send(player.socket, type, data);
    });
}

function getRoom(socket) {
    return rooms.get(socket.data.roomCode);
}

function getPlayerIndex(socket) {
    return socket.data.playerIndex;
}

function getOpponentIndex(playerIndex) {
    return playerIndex === 0 ? 1 : 0;
}

function isFinished(player) {
    return player.pieces.every(
        position => position === FINISH
    );
}

function canMove(room, playerIndex, pieceIndex) {
    const player = room.players[playerIndex];

    if (!player) {
        return false;
    }

    const dice = room.dice;
    const position = player.pieces[pieceIndex];

    if (dice === null) {
        return false;
    }

    if (position === FINISH) {
        return false;
    }

    // مهره داخل خانه فقط با 6 بیرون می‌آید
    if (position === HOME) {
        return dice === 6;
    }

    return position + dice <= FINISH;
}

function hasMovablePiece(room, playerIndex) {
    const player = room.players[playerIndex];

    if (!player || room.dice === null) {
        return false;
    }

    return player.pieces.some(
        (_, index) =>
            canMove(room, playerIndex, index)
    );
}

function sendState(room) {

    room.players.forEach((player, index) => {

        const opponent =
            room.players[getOpponentIndex(index)];

        send(player.socket, "gameState", {

            roomCode: room.code,

            myColor: player.color,

            myName: player.name,

            opponentName:
                opponent
                    ? opponent.name
                    : "در انتظار بازیکن",

            myPieces: [...player.pieces],

            opponentPieces:
                opponent
                    ? [...opponent.pieces]
                    : [],

            turn: room.turn,

            myTurn:
                room.turn === index,

            dice: room.dice,

            gameStarted: room.started,

            winner: room.winner

        });

    });
}

function nextTurn(room, playerIndex) {

    const player =
        room.players[playerIndex];

    // با 6 نوبت دوباره همان بازیکن است
    if (room.dice === 6) {
        room.dice = null;
        sendState(room);
        return;
    }

    room.dice = null;

    room.turn =
        getOpponentIndex(playerIndex);

    sendState(room);
}

function movePiece(room, playerIndex, pieceIndex) {

    const player =
        room.players[playerIndex];

    const opponentIndex =
        getOpponentIndex(playerIndex);

    const opponent =
        room.players[opponentIndex];

    const dice =
        room.dice;

    const oldPosition =
        player.pieces[pieceIndex];

    let newPosition;

    // خروج از خانه
    if (oldPosition === HOME) {
        newPosition = 0;
    } else {
        newPosition = oldPosition + dice;
    }

    player.pieces[pieceIndex] =
        newPosition;

    let captured = false;

    /*
     * زدن مهره حریف
     * فقط روی مسیر اصلی
     */
    if (
        newPosition >= 0 &&
        newPosition < PATH_LENGTH
    ) {

        opponent.pieces =
            opponent.pieces.map(position => {

                if (position === newPosition) {

                    captured = true;

                    return HOME;
                }

                return position;
            });

    }

    broadcast(room, "pieceMoved", {

        playerIndex,

        pieceIndex,

        oldPosition,

        newPosition,

        captured

    });

    if (captured) {

        broadcast(room, "capture", {

            player:
                player.name,

            color:
                player.color

        });

    }

    /*
     * بررسی برد
     */
    if (isFinished(player)) {

        room.winner =
            playerIndex;

        room.started = false;

        room.dice = null;

        broadcast(room, "winner", {

            winner:
                player.name,

            color:
                player.color,

            loser:
                opponent.name

        });

        sendState(room);

        return;
    }

    /*
     * حرکت مجاز انجام شد.
     * اگر 6 یا زدن مهره باشد،
     * نوبت دوباره به همان بازیکن می‌رسد.
     */

    if (
        dice === 6 ||
        captured
    ) {

        room.dice = null;

    } else {

        room.dice = null;

        room.turn =
            opponentIndex;
    }

    sendState(room);
}


/*
========================================
اتصال بازیکن
========================================
*/

io.on("connection", socket => {

    console.log(
        "Player connected:",
        socket.id
    );


    /*
    ========================================
    ساخت اتاق
    ========================================
    */

    socket.on("createRoom", data => {

        const roomCode =
            createRoomCode();

        const name =
            String(
                data?.name || "بازیکن ۱"
            )
            .trim()
            .substring(0, 20);

        const room = {

            code: roomCode,

            players: [],

            turn: 0,

            dice: null,

            started: false,

            winner: null

        };

        const player =
            createPlayer(
                socket,
                name,
                COLORS[0]
            );

        room.players.push(player);

        rooms.set(
            roomCode,
            room
        );

        socket.join(roomCode);

        socket.data.roomCode =
            roomCode;

        socket.data.playerIndex =
            0;

        send(
            socket,
            "roomCreated",
            {
                roomCode
            }
        );

        sendState(room);

        console.log(
            "Room created:",
            roomCode
        );

    });


    /*
    ========================================
    ورود بازیکن دوم
    ========================================
    */

    socket.on("joinRoom", data => {

        const roomCode =
            String(
                data?.roomCode || ""
            )
            .trim()
            .toUpperCase();

        const room =
            rooms.get(roomCode);

        if (!room) {

            send(
                socket,
                "errorMessage",
                {
                    message:
                        "❌ اتاق پیدا نشد."
                }
            );

            return;
        }

        if (room.players.length >= 2) {

            send(
                socket,
                "errorMessage",
                {
                    message:
                        "❌ این اتاق پر است."
                }
            );

            return;
        }

        const name =
            String(
                data?.name || "بازیکن ۲"
            )
            .trim()
            .substring(0, 20);

        const player =
            createPlayer(
                socket,
                name,
                COLORS[1]
            );

        room.players.push(player);

        socket.join(roomCode);

        socket.data.roomCode =
            roomCode;

        socket.data.playerIndex =
            1;

        room.started = true;

        room.turn = 0;

        room.dice = null;

        room.winner = null;

        broadcast(
            room,
            "gameStarted",
            {
                message:
                    "🎲 بازی شروع شد!"
            }
        );

        sendState(room);

        console.log(
            "Player joined room:",
            roomCode
        );

    });


    /*
    ========================================
    انداختن تاس
    ========================================
    */

    socket.on("rollDice", () => {

        const room =
            getRoom(socket);

        if (!room) {
            return;
        }

        const playerIndex =
            getPlayerIndex(socket);

        if (
            !room.started ||
            room.winner !== null
        ) {
            return;
        }

        if (
            room.turn !== playerIndex
        ) {

            send(
                socket,
                "errorMessage",
                {
                    message:
                        "⏳ الان نوبت تو نیست."
                }
            );

            return;
        }

        // جلوگیری از دوبار تاس انداختن
        if (room.dice !== null) {
            return;
        }

        const dice =
            Math.floor(
                Math.random() * 6
            ) + 1;

        room.dice = dice;

        broadcast(
            room,
            "diceRolled",
            {
                playerIndex,
                dice
            }
        );

        /*
         * اگر مهره‌ای قابل حرکت نیست،
         * بعد از کمی تأخیر نوبت عوض شود.
         */

        if (
            !hasMovablePiece(
                room,
                playerIndex
            )
        ) {

            send(
                socket,
                "noMove",
                {
                    dice
                }
            );

            setTimeout(() => {

                if (
                    !room.started ||
                    room.dice !== dice
                ) {
                    return;
                }

                nextTurn(
                    room,
                    playerIndex
                );

            }, 1200);

            return;
        }

        sendState(room);

    });


    /*
    ========================================
    حرکت مهره
    ========================================
    */

    socket.on("movePiece", data => {

        const room =
            getRoom(socket);

        if (!room) {
            return;
        }

        const playerIndex =
            getPlayerIndex(socket);

        if (
            !room.started ||
            room.winner !== null
        ) {
            return;
        }

        if (
            room.turn !== playerIndex
        ) {
            return;
        }

        if (room.dice === null) {
            return;
        }

        const pieceIndex =
            Number(
                data?.pieceIndex
            );

        if (
            !Number.isInteger(pieceIndex) ||
            pieceIndex < 0 ||
            pieceIndex > 3
        ) {
            return;
        }

        if (
            !canMove(
                room,
                playerIndex,
                pieceIndex
            )
        ) {

            send(
                socket,
                "errorMessage",
                {
                    message:
                        "❌ این مهره قابل حرکت نیست."
                }
            );

            return;
        }

        movePiece(
            room,
            playerIndex,
            pieceIndex
        );

    });


    /*
    ========================================
    چت
    ========================================
    */

    socket.on("chatMessage", data => {

        const room =
            getRoom(socket);

        if (!room) {
            return;
        }

        const playerIndex =
            getPlayerIndex(socket);

        const player =
            room.players[playerIndex];

        if (!player) {
            return;
        }

        const message =
            String(
                data?.message || ""
            )
            .trim()
            .substring(0, 200);

        if (!message) {
            return;
        }

        broadcast(
            room,
            "chatMessage",
            {
                name:
                    player.name,

                color:
                    player.color,

                message
            }
        );

    });


    /*
    ========================================
    ایموجی سریع
    ========================================
    */

    socket.on("emoji", data => {

        const room =
            getRoom(socket);

        if (!room) {
            return;
        }

        const playerIndex =
            getPlayerIndex(socket);

        const player =
            room.players[playerIndex];

        if (!player) {
            return;
        }

        const allowed =
            [
                "😂",
                "😎",
                "🔥",
                "😱",
                "👏",
                "😍",
                "🎉",
                "😭",
                "🤣",
                "😡",
                "👍",
                "❤️",
                "🎲"
            ];

        const emoji =
            String(
                data?.emoji || ""
            );

        if (
            !allowed.includes(emoji)
        ) {
            return;
        }

        broadcast(
            room,
            "emoji",
            {
                name:
                    player.name,

                color:
                    player.color,

                emoji
            }
        );

    });


    /*
    ========================================
    قطع اتصال
    ========================================
    */

    socket.on("disconnect", () => {

        console.log(
            "Player disconnected:",
            socket.id
        );

        const room =
            getRoom(socket);

        if (!room) {
            return;
        }

        const playerIndex =
            getPlayerIndex(socket);

        const opponentIndex =
            getOpponentIndex(
                playerIndex
            );

        const opponent =
            room.players[opponentIndex];

        if (opponent) {

            send(
                opponent.socket,
                "opponentLeft"
            );

        }

        rooms.delete(room.code);

    });

});


const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () => {

        console.log(
            "🎲 Online Ludo server started on port " +
            PORT
        );

    }
);
