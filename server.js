const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const rooms = new Map();

const START = -1;
const FINISH = 56;
const PATH_LENGTH = 52;
const PIECES = 4;


// =========================
// ابزارها
// =========================

function cleanName(name, fallback) {

    const value =
        String(name || "")
            .trim()
            .slice(0, 20);

    return value || fallback;
}


function makeRoom(id) {

    return {

        id: id,

        players: [],

        turn: 0,

        started: false,

        winner: null

    };

}


// =========================
// وضعیت بازی
// =========================

function publicState(room, playerIndex) {

    const me =
        room.players[playerIndex];

    const opponent =
        room.players[1 - playerIndex];

    return {

        roomCode: room.id,

        myColor: me.color,

        myName: me.name,

        opponentName:
            opponent
                ? opponent.name
                : "حریف",

        myPieces:
            [...me.pieces],

        opponentPieces:
            opponent
                ? [...opponent.pieces]
                : [
                    START,
                    START,
                    START,
                    START
                ],

        dice:
            me.dice ?? null,

        myTurn:
            room.started &&
            !room.winner &&
            room.turn === playerIndex,

        gameStarted:
            room.started &&
            room.players.length === 2 &&
            !room.winner

    };

}


function emitState(room) {

    room.players.forEach(
        function(player, index) {

            if(
                player.socket.connected
            ) {

                player.socket.emit(
                    "gameState",
                    publicState(
                        room,
                        index
                    )
                );

            }

        }
    );

}


// =========================
// تغییر نوبت
// =========================

function nextTurn(room) {

    room.players.forEach(
        function(player) {

            player.dice = null;

        }
    );

    room.turn =
        room.turn === 0
            ? 1
            : 0;

    emitState(room);

}


// =========================
// بررسی امکان حرکت
// =========================

function hasMove(player, dice) {

    return player.pieces.some(
        function(position) {

            if(position === FINISH) {

                return false;

            }

            if(position === START) {

                return dice === 6;

            }

            return (
                position + dice
                <= FINISH
            );

        }
    );

}


function canMovePiece(
    player,
    pieceIndex,
    dice
) {

    if(
        !Number.isInteger(
            pieceIndex
        )
    ) {

        return false;

    }

    if(
        pieceIndex < 0 ||
        pieceIndex >= PIECES
    ) {

        return false;

    }

    const position =
        player.pieces[pieceIndex];

    if(position === FINISH) {

        return false;

    }

    if(position === START) {

        return dice === 6;

    }

    return (
        position + dice
        <= FINISH
    );

}


// =========================
// محاسبه خانه واقعی مسیر
// =========================

function absolutePathPosition(
    playerIndex,
    progress
) {

    if(
        progress < 0 ||
        progress >= PATH_LENGTH
    ) {

        return null;

    }

    const offset =
        playerIndex === 0
            ? 0
            : 26;

    return (
        offset + progress
    ) % PATH_LENGTH;

}


// =========================
// زدن مهره حریف
// =========================

function capture(
    room,
    moverIndex,
    newPosition
) {

    const opponentIndex =
        1 - moverIndex;

    const opponent =
        room.players[
            opponentIndex
        ];

    const absolute =
        absolutePathPosition(
            moverIndex,
            newPosition
        );

    if(absolute === null) {

        return false;

    }

    let didCapture = false;

    opponent.pieces =
        opponent.pieces.map(
            function(position) {

                if(
                    position >= 0 &&
                    position < PATH_LENGTH
                ) {

                    const opponentAbsolute =
                        absolutePathPosition(
                            opponentIndex,
                            position
                        );

                    if(
                        opponentAbsolute ===
                        absolute
                    ) {

                        didCapture = true;

                        return START;

                    }

                }

                return position;

            }
        );

    return didCapture;

}


// =========================
// پیدا کردن اتاق بازیکن
// =========================

function roomForSocket(socket) {

    const roomId =
        socket.data.roomId;

    if(!roomId) {

        return null;

    }

    return rooms.get(roomId);

}


// =========================
// خروج بازیکن
// =========================

function leaveRoom(socket) {

    const room =
        roomForSocket(socket);

    if(!room) {

        return;

    }

    const index =
        room.players.findIndex(
            function(player) {

                return (
                    player.socket.id ===
                    socket.id
                );

            }
        );

    if(index !== -1) {

        room.players.splice(
            index,
            1
        );

    }

    socket.data.roomId = null;

    if(room.players.length > 0) {

        room.players[0]
            .socket
            .emit(
                "opponentLeft"
            );

    }

    if(room.players.length === 0) {

        rooms.delete(
            room.id
        );

    }

}


// =========================
// اتصال Socket.IO
// =========================

io.on(
    "connection",
    function(socket) {


        // =========================
        // ساخت اتاق
        // =========================

        socket.on(
            "createRoom",
            function(data) {

                if(
                    roomForSocket(socket)
                ) {

                    socket.emit(
                        "errorMessage",
                        {
                            message:
                                "شما قبلاً داخل یک اتاق هستید."
                        }
                    );

                    return;

                }

                let roomCode;

                do {

                    roomCode =
                        Math.random()
                            .toString(36)
                            .slice(2, 8)
                            .toUpperCase();

                }
                while(
                    rooms.has(roomCode)
                );


                const room =
                    makeRoom(
                        roomCode
                    );


                room.players.push({

                    socket: socket,

                    name:
                        cleanName(
                            data?.name,
                            "بازیکن ۱"
                        ),

                    color: "red",

                    pieces: [
                        START,
                        START,
                        START,
                        START
                    ],

                    dice: null

                });


                rooms.set(
                    roomCode,
                    room
                );


                socket.data.roomId =
                    roomCode;

                socket.data.playerIndex =
                    0;


                socket.emit(
                    "roomCreated",
                    {
                        roomCode:
                            roomCode
                    }
                );


                emitState(room);

            }
        );


        // =========================
        // ورود به اتاق
        // =========================

        socket.on(
            "joinRoom",
            function(data) {

                if(
                    roomForSocket(socket)
                ) {

                    socket.emit(
                        "errorMessage",
                        {
                            message:
                                "شما قبلاً داخل یک اتاق هستید."
                        }
                    );

                    return;

                }


                const roomCode =
                    String(
                        data?.roomCode || ""
                    )
                    .trim()
                    .toUpperCase();


                const room =
                    rooms.get(
                        roomCode
                    );


                if(!room) {

                    socket.emit(
                        "errorMessage",
                        {
                            message:
                                "این اتاق پیدا نشد."
                        }
                    );

                    return;

                }


                if(
                    room.players.length >= 2
                ) {

                    socket.emit(
                        "errorMessage",
                        {
                            message:
                                "این اتاق پر است."
                        }
                    );

                    return;

                }


                room.players.push({

                    socket: socket,

                    name:
                        cleanName(
                            data?.name,
                            "بازیکن ۲"
                        ),

                    color: "blue",

                    pieces: [
                        START,
                        START,
                        START,
                        START
                    ],

                    dice: null

                });


                socket.data.roomId =
                    roomCode;

                socket.data.playerIndex =
                    1;


                room.started = true;

                room.turn = 0;


                room.players.forEach(
                    function(player) {

                        player.socket.emit(
                            "gameStarted"
                        );

                    }
                );


                emitState(room);

            }
        );


        // =========================
        // انداختن تاس
        // =========================

        socket.on(
            "rollDice",
            function() {

                const room =
                    roomForSocket(
                        socket
                    );


                if(
                    !room ||
                    !room.started ||
                    room.winner
                ) {

                    return;

                }


                const index =
                    socket.data.playerIndex;


                if(
                    room.turn !== index
                ) {

                    return;

                }


                const player =
                    room.players[index];


                if(
                    player.dice !== null
                ) {

                    return;

                }


                const dice =
                    Math.floor(
                        Math.random() * 6
                    ) + 1;


                player.dice =
                    dice;


                room.players.forEach(
                    function(p) {

                        p.socket.emit(
                            "diceRolled",
                            {
                                player:
                                    player.name,

                                color:
                                    player.color,

                                dice:
                                    dice
                            }
                        );

                    }
                );


                const movable =
                    hasMove(
                        player,
                        dice
                    );


                // اگر هیچ مهره‌ای
                // قابل حرکت نبود

                if(!movable) {

                    player.socket.emit(
                        "noMove",
                        {
                            dice:
                                dice
                        }
                    );


                    setTimeout(
                        function() {

                            if(
                                !rooms.has(
                                    room.id
                                )
                            ) {

                                return;

                            }


                            if(room.winner) {

                                return;

                            }


                            const current =
                                room.players[
                                    room.turn
                                ];


                            if(
                                !current ||
                                current !== player ||
                                current.dice !== dice
                            ) {

                                return;

                            }


                            nextTurn(room);

                        },
                        900
                    );

                }


                emitState(room);

            }
        );


        // =========================
        // حرکت مهره
        // =========================

        socket.on(
            "movePiece",
            function(data) {

                const room =
                    roomForSocket(
                        socket
                    );


                if(
                    !room ||
                    !room.started ||
                    room.winner
                ) {

                    return;

                }


                const index =
                    socket.data.playerIndex;


                if(
                    room.turn !== index
                ) {

                    return;

                }


                const player =
                    room.players[index];


                const dice =
                    player.dice;


                if(
                    !Number.isInteger(
                        dice
                    )
                ) {

                    return;

                }


                const pieceIndex =
                    Number(
                        data?.pieceIndex
                    );


                if(
                    !canMovePiece(
                        player,
                        pieceIndex,
                        dice
                    )
                ) {

                    return;

                }


                const oldPosition =
                    player.pieces[
                        pieceIndex
                    ];


                let newPosition;


                // خروج مهره از خانه

                if(
                    oldPosition === START
                ) {

                    newPosition = 0;

                }

                else {

                    newPosition =
                        oldPosition + dice;

                }


                player.pieces[
                    pieceIndex
                ] =
                    newPosition;


                player.dice = null;


                // بررسی زدن حریف

                const didCapture =
                    capture(
                        room,
                        index,
                        newPosition
                    );


                if(didCapture) {

                    room.players.forEach(
                        function(p) {

                            p.socket.emit(
                                "capture",
                                {
                                    player:
                                        player.name,

                                    color:
                                        player.color
                                }
                            );

                        }
                    );

                }


                room.players.forEach(
                    function(p) {

                        p.socket.emit(
                            "pieceMoved",
                            {
                                player:
                                    player.name,

                                color:
                                    player.color,

                                pieceIndex:
                                    pieceIndex,

                                oldPosition:
                                    oldPosition,

                                newPosition:
                                    newPosition,

                                dice:
                                    dice
                            }
                        );

                    }
                );


                // =========================
                // بررسی برنده
                // =========================

                if(
                    player.pieces.every(
                        function(position) {

                            return (
                                position ===
                                FINISH
                            );

                        }
                    )
                ) {

                    room.winner =
                        index;


                    room.players.forEach(
                        function(p) {

                            p.socket.emit(
                                "winner",
                                {
                                    winner:
                                        player.name,

                                    color:
                                        player.color,

                                    playerIndex:
                                        index
                                }
                            );

                        }
                    );


                    emitState(room);

                    return;

                }


                // =========================
                // اگر ۶ آمد
                // دوباره نوبت همان بازیکن
                // =========================

                if(
                    dice === 6
                ) {

                    room.turn =
                        index;

                    emitState(room);

                }

                else {

                    nextTurn(room);

                }

            }
        );


        // =========================
        // چت
        // =========================

        socket.on(
            "chatMessage",
            function(data) {

                const room =
                    roomForSocket(
                        socket
                    );


                if(!room) {

                    return;

                }


                const index =
                    socket.data.playerIndex;


                const player =
                    room.players[index];


                if(!player) {

                    return;

                }


                const message =
                    String(
                        data?.message || ""
                    )
                    .trim()
                    .slice(0, 200);


                if(!message) {

                    return;

                }


                room.players.forEach(
                    function(p) {

                        p.socket.emit(
                            "chatMessage",
                            {
                                name:
                                    player.name,

                                color:
                                    player.color,

                                message:
                                    message
                            }
                        );

                    }
                );

            }
        );


        // =========================
        // ایموجی
        // =========================

        socket.on(
            "emoji",
            function(data) {

                const room =
                    roomForSocket(
                        socket
                    );


                if(!room) {

                    return;

                }


                const index =
                    socket.data.playerIndex;


                const player =
                    room.players[index];


                if(!player) {

                    return;

                }


                const allowed = [

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


                if(
                    !allowed.includes(
                        emoji
                    )
                ) {

                    return;

                }


                room.players.forEach(
                    function(p) {

                        p.socket.emit(
                            "emoji",
                            {
                                name:
                                    player.name,

                                color:
                                    player.color,

                                emoji:
                                    emoji
                            }
                        );

                    }
                );

            }
        );


        // =========================
        // قطع اتصال
        // =========================

        socket.on(
            "disconnect",
            function() {

                leaveRoom(socket);

            }
        );

    }
);


// =========================
// اجرای سرور
// =========================

server.listen(
    PORT,
    function() {

        console.log(
            "Ludo server started on port "
            + PORT
        );

    }
);
