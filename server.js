const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = new Map();

const HOME = -1;
const FINISH = 56;
const MAIN_PATH = 52;

const COLORS = ["red", "blue"];

const ALLOWED_EMOJIS = [
    "😂", "😎", "🔥", "😱", "👏", "😍",
    "🎉", "😭", "🤣", "😡", "👍", "❤️", "🎲"
];


function createRoomCode() {

    let code;

    do {

        code = Math.random()
            .toString(36)
            .slice(2, 8)
            .toUpperCase();

    } while (rooms.has(code));

    return code;
}


function createPlayer(socket, name, color) {

    return {

        socket,
        socketId: socket.id,

        name:
            name || "بازیکن",

        color,

        pieces: [
            HOME,
            HOME,
            HOME,
            HOME
        ]

    };
}


function getRoom(socket) {

    return rooms.get(
        socket.data.roomCode
    );

}


function getPlayerIndex(socket) {

    return socket.data.playerIndex;

}


function opponentIndex(index) {

    return index === 0 ? 1 : 0;

}


function emitTo(
    socket,
    event,
    data = {}
) {

    if (
        socket &&
        socket.connected
    ) {

        socket.emit(
            event,
            data
        );

    }

}


function broadcast(
    room,
    event,
    data = {}
) {

    for (
        const player of room.players
    ) {

        emitTo(
            player.socket,
            event,
            data
        );

    }

}


function isWinner(player) {

    return player.pieces.every(
        position =>
            position === FINISH
    );

}


function canMove(
    room,
    playerIndex,
    pieceIndex
) {

    if (
        !room.started ||
        room.dice === null
    ) {

        return false;

    }


    const player =
        room.players[playerIndex];


    if (
        !player ||
        !Number.isInteger(pieceIndex) ||
        pieceIndex < 0 ||
        pieceIndex > 3
    ) {

        return false;

    }


    const position =
        player.pieces[pieceIndex];


    if (
        position === FINISH
    ) {

        return false;

    }


    /*
    مهره داخل خانه
    فقط با ۶ بیرون می‌آید
    */

    if (
        position === HOME
    ) {

        return room.dice === 6;

    }


    /*
    جلوگیری از رد شدن
    از خانه پایانی
    */

    return (
        position +
        room.dice <=
        FINISH
    );

}


function hasMovablePiece(
    room,
    playerIndex
) {

    return [
        0,
        1,
        2,
        3
    ].some(
        index =>
            canMove(
                room,
                playerIndex,
                index
            )
    );

}


function sendState(room) {

    room.players.forEach(
        (
            player,
            index
        ) => {

            const opponent =
                room.players[
                    opponentIndex(index)
                ];


            emitTo(
                player.socket,
                "gameState",
                {

                    roomCode:
                        room.code,

                    myColor:
                        player.color,

                    myName:
                        player.name,

                    opponentName:
                        opponent
                            ? opponent.name
                            : "در انتظار بازیکن",

                    myPieces:
                        [...player.pieces],

                    opponentPieces:
                        opponent
                            ? [...opponent.pieces]
                            : [],

                    turn:
                        room.turn,

                    myTurn:
                        room.started &&
                        room.turn === index,

                    dice:
                        room.dice,

                    gameStarted:
                        room.started,

                    winner:
                        room.winner

                }
            );

        }
    );

}


function advanceTurn(
    room,
    playerIndex
) {

    const rolled =
        room.dice;


    room.dice = null;


    /*
    با ۶ دوباره
    همان بازیکن بازی می‌کند
    */

    if (
        rolled === 6
    ) {

        room.turn =
            playerIndex;

    } else {

        room.turn =
            opponentIndex(
                playerIndex
            );

    }


    sendState(room);

}


function movePiece(
    room,
    playerIndex,
    pieceIndex
) {

    const player =
        room.players[playerIndex];


    const opponent =
        room.players[
            opponentIndex(
                playerIndex
            )
        ];


    const dice =
        room.dice;


    const oldPosition =
        player.pieces[
            pieceIndex
        ];


    /*
    خروج مهره از خانه
    */

    const newPosition =
        oldPosition === HOME
            ? 0
            : oldPosition + dice;


    player.pieces[
        pieceIndex
    ] = newPosition;


    /*
    بررسی زدن مهره حریف
    */

    let captured = false;


    if (
        newPosition >= 0 &&
        newPosition < MAIN_PATH
    ) {

        opponent.pieces =
            opponent.pieces.map(
                position => {

                    if (
                        position ===
                        newPosition
                    ) {

                        captured = true;

                        return HOME;

                    }

                    return position;

                }
            );

    }


    /*
    اعلام حرکت
    */

    broadcast(
        room,
        "pieceMoved",
        {

            playerIndex,

            pieceIndex,

            oldPosition,

            newPosition,

            captured

        }
    );


    /*
    اعلام زدن مهره
    */

    if (
        captured
    ) {

        broadcast(
            room,
            "capture",
            {

                player:
                    player.name,

                color:
                    player.color

            }
        );

    }


    /*
    بررسی برنده
    */

    if (
        isWinner(player)
    ) {

        room.winner =
            playerIndex;

        room.started =
            false;

        room.dice =
            null;


        broadcast(
            room,
            "winner",
            {

                winner:
                    player.name,

                color:
                    player.color,

                loser:
                    opponent.name

            }
        );


        sendState(room);

        return;

    }


    /*
    پایان نوبت
    */

    room.dice =
        null;


    /*
    با ۶ یا زدن مهره
    دوباره نوبت همان بازیکن
    */

    if (
        dice !== 6 &&
        !captured
    ) {

        room.turn =
            opponentIndex(
                playerIndex
            );

    }


    sendState(room);

}


/*
========================================
اتصال بازیکن
========================================
*/

io.on(
    "connection",
    socket => {


        /*
        =================================
        ساخت اتاق
        =================================
        */

        socket.on(
            "createRoom",
            data => {

                const code =
                    createRoomCode();


                const name =
                    String(
                        data?.name ||
                        "بازیکن ۱"
                    )
                    .trim()
                    .slice(0, 20);


                const room = {

                    code,

                    players: [],

                    turn: 0,

                    dice: null,

                    started: false,

                    winner: null

                };


                room.players.push(
                    createPlayer(
                        socket,
                        name,
                        COLORS[0]
                    )
                );


                rooms.set(
                    code,
                    room
                );


                socket.join(code);


                socket.data.roomCode =
                    code;


                socket.data.playerIndex =
                    0;


                emitTo(
                    socket,
                    "roomCreated",
                    {
                        roomCode:
                            code
                    }
                );


                sendState(room);

            }
        );


        /*
        =================================
        ورود بازیکن دوم
        =================================
        */

        socket.on(
            "joinRoom",
            data => {

                const code =
                    String(
                        data?.roomCode ||
                        ""
                    )
                    .trim()
                    .toUpperCase();


                const room =
                    rooms.get(code);


                if (!room) {

                    return emitTo(
                        socket,
                        "errorMessage",
                        {
                            message:
                                "❌ اتاق پیدا نشد."
                        }
                    );

                }


                if (
                    room.players.length >= 2
                ) {

                    return emitTo(
                        socket,
                        "errorMessage",
                        {
                            message:
                                "❌ این اتاق پر است."
                        }
                    );

                }


                const name =
                    String(
                        data?.name ||
                        "بازیکن ۲"
                    )
                    .trim()
                    .slice(0, 20);


                room.players.push(
                    createPlayer(
                        socket,
                        name,
                        COLORS[1]
                    )
                );


                socket.join(code);


                socket.data.roomCode =
                    code;


                socket.data.playerIndex =
                    1;


                room.started =
                    true;


                room.turn =
                    0;


                room.dice =
                    null;


                room.winner =
                    null;


                broadcast(
                    room,
                    "gameStarted",
                    {
                        message:
                            "🎲 بازی شروع شد!"
                    }
                );


                sendState(room);

            }
        );


        /*
        =================================
        انداختن تاس
        =================================
        */

        socket.on(
            "rollDice",
            () => {

                const room =
                    getRoom(socket);


                if (
                    !room ||
                    !room.started ||
                    room.winner !== null
                ) {

                    return;

                }


                const playerIndex =
                    getPlayerIndex(
                        socket
                    );


                if (
                    room.turn !==
                    playerIndex
                ) {

                    return emitTo(
                        socket,
                        "errorMessage",
                        {
                            message:
                                "⏳ الان نوبت تو نیست."
                        }
                    );

                }


                /*
                جلوگیری از
                دوبار تاس
                */

                if (
                    room.dice !== null
                ) {

                    return;

                }


                room.dice =
                    Math.floor(
                        Math.random() * 6
                    ) + 1;


                const dice =
                    room.dice;


                broadcast(
                    room,
                    "diceRolled",
                    {

                        playerIndex,

                        dice

                    }
                );


                /*
                اگر هیچ مهره‌ای
                قابل حرکت نبود
                */

                if (
                    !hasMovablePiece(
                        room,
                        playerIndex
                    )
                ) {

                    emitTo(
                        socket,
                        "noMove",
                        {
                            dice
                        }
                    );


                    setTimeout(
                        () => {

                            if (
                                !room.started ||
                                room.dice !== dice
                            ) {

                                return;

                            }


                            advanceTurn(
                                room,
                                playerIndex
                            );

                        },
                        1200
                    );


                    return;

                }


                sendState(room);

            }
        );


        /*
        =================================
        حرکت مهره
        =================================
        */

        socket.on(
            "movePiece",
            data => {

                const room =
                    getRoom(socket);


                if (
                    !room ||
                    !room.started ||
                    room.winner !== null
                ) {

                    return;

                }


                const playerIndex =
                    getPlayerIndex(
                        socket
                    );


                if (
                    room.turn !==
                    playerIndex
                ) {

                    return;

                }


                if (
                    room.dice === null
                ) {

                    return;

                }


                const pieceIndex =
                    Number(
                        data?.pieceIndex
                    );


                if (
                    !canMove(
                        room,
                        playerIndex,
                        pieceIndex
                    )
                ) {

                    return emitTo(
                        socket,
                        "errorMessage",
                        {
                            message:
                                "❌ این مهره قابل حرکت نیست."
                        }
                    );

                }


                movePiece(
                    room,
                    playerIndex,
                    pieceIndex
                );

            }
        );


        /*
        =================================
        چت
        =================================
        */

        socket.on(
            "chatMessage",
            data => {

                const room =
                    getRoom(socket);


                if (!room) {
                    return;
                }


                const player =
                    room.players[
                        getPlayerIndex(
                            socket
                        )
                    ];


                if (!player) {
                    return;
                }


                const message =
                    String(
                        data?.message ||
                        ""
                    )
                    .trim()
                    .slice(0, 200);


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

            }
        );


        /*
        =================================
        ایموجی سریع
        =================================
        */

        socket.on(
            "emoji",
            data => {

                const room =
                    getRoom(socket);


                if (!room) {
                    return;
                }


                const player =
                    room.players[
                        getPlayerIndex(
                            socket
                        )
                    ];


                const emoji =
                    String(
                        data?.emoji ||
                        ""
                    );


                if (
                    !player ||
                    !ALLOWED_EMOJIS.includes(
                        emoji
                    )
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

            }
        );


        /*
        =================================
        قطع اتصال
        =================================
        */

        socket.on(
            "disconnect",
            () => {

                const room =
                    getRoom(socket);


                if (!room) {
                    return;
                }


                const other =
                    room.players.find(
                        player =>
                            player.socketId !==
                            socket.id
                    );


                if (other) {

                    emitTo(
                        other.socket,
                        "opponentLeft"
                    );

                }


                rooms.delete(
                    room.code
                );

            }
        );

    }
);


const PORT =
    process.env.PORT || 3000;


server.listen(
    PORT,
    () => {

        console.log(
            `🎲 Online Ludo server started on port ${PORT}`
        );

    }
);
