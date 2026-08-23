const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

const questions = [
    {
        q: "مهربان‌ترین مرد نیشابور کیست؟",
        a: ["رضا", "جعفرآقا", "اصغر آقا", "اکبرآباد"],
        correct: 0
    },
    {
        q: "باهوش‌ترین دختر نیشابور کیست؟",
        a: ["صغرا", "ژینا", "رقیه", "کبری"],
        correct: 2
    },
    {
        q: "کدام سیاره به سیاره سرخ معروف است؟",
        a: ["زهره", "مریخ", "عطارد", "نپتون"],
        correct: 1
    },
    {
        q: "بزرگ‌ترین اقیانوس جهان کدام است؟",
        a: ["اطلس", "هند", "آرام", "منجمد شمالی"],
        correct: 2
    },
    {
        q: "سریع‌ترین حیوان خشکی کدام است؟",
        a: ["شیر", "یوزپلنگ", "اسب", "گرگ"],
        correct: 1
    },
    {
        q: "چند قاره در جهان وجود دارد؟",
        a: ["5", "6", "7", "8"],
        correct: 2
    },
    {
        q: "آب در چند درجه سانتی‌گراد یخ می‌زند؟",
        a: ["0", "10", "50", "100"],
        correct: 0
    },
    {
        q: "بزرگ‌ترین قاره جهان کدام است؟",
        a: ["آفریقا", "اروپا", "آسیا", "استرالیا"],
        correct: 2
    },
    {
        q: "نزدیک‌ترین سیاره به خورشید کدام است؟",
        a: ["زمین", "مریخ", "عطارد", "زهره"],
        correct: 2
    },
    {
        q: "ماهواره طبیعی زمین چیست؟",
        a: ["خورشید", "ماه", "مریخ", "زهره"],
        correct: 1
    }
];


/* =========================
   FUNCTIONS
========================= */

function sendQuestion(room) {

    if (!room || room.players.length < 2) {
        return;
    }

    if (room.timer) {
        clearInterval(room.timer);
    }

    const question = questions[room.question];

    room.answers = {};
    room.timeLeft = 15;

    io.to(room.id).emit("newQuestion", {
        id: room.question,
        question: question.q,
        answers: question.a,
        time: 15
    });

    room.timer = setInterval(() => {

        room.timeLeft--;

        io.to(room.id).emit("timer", {
            time: room.timeLeft
        });

        if (room.timeLeft <= 0) {

            clearInterval(room.timer);
            room.timer = null;

            io.to(room.id).emit("timeUp");

            finishQuestion(room);
        }

    }, 1000);
}


function finishQuestion(room) {

    if (!room || room.finishedQuestion) {
        return;
    }

    room.finishedQuestion = true;

    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }

    const question = questions[room.question];

    const results = [];

    for (let i = 0; i < 2; i++) {

        const answer = room.answers[i];

        const correct =
            answer !== undefined &&
            Number(answer) === question.correct;

        results.push(correct);

        if (correct) {

            room.players[i].combo++;

            const damage =
                10 + Math.min(
                    room.players[i].combo * 2,
                    20
                );

            const opponent = room.players[1 - i];

            if (!opponent.shield) {

                opponent.hp -= damage;

                if (opponent.hp < 0) {
                    opponent.hp = 0;
                }

            } else {

                opponent.shield = false;

                io.to(room.players[1 - i].socketId)
                    .emit("powerResult", {
                        message: "🛡️ Shield حمله را خنثی کرد!"
                    });
            }

            io.to(room.players[i].socketId)
                .emit("answerResult", {
                    correct: true,
                    damage: damage
                });

        } else {

            room.players[i].combo = 0;

            io.to(room.players[i].socketId)
                .emit("answerResult", {
                    correct: false,
                    damage: 0
                });
        }
    }


    /* HP UPDATE */

    io.to(room.id).emit("hpUpdate", {

        myHP: undefined,
        enemyHP: undefined

    });

    room.players.forEach((player, index) => {

        const opponent =
            room.players[1 - index];

        io.to(player.socketId).emit("hpUpdate", {

            myHP: player.hp,
            enemyHP: opponent.hp

        });

        io.to(player.socketId).emit("powerResult", {

            myHP: player.hp,
            enemyHP: opponent.hp

        });

    });


    /* GAME OVER */

    if (
        room.players[0].hp <= 0 ||
        room.players[1].hp <= 0
    ) {

        finishGame(room);
        return;
    }


    /* NEXT QUESTION */

    setTimeout(() => {

        if (!rooms[room.id]) {
            return;
        }

        room.question++;

        if (room.question >= questions.length) {

            finishGame(room);
            return;
        }

        room.finishedQuestion = false;

        sendQuestion(room);

    }, 2000);
}


function finishGame(room) {

    if (!room) {
        return;
    }

    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }

    let winner = -1;

    if (room.players[0].hp > room.players[1].hp) {
        winner = 0;
    }

    if (room.players[1].hp > room.players[0].hp) {
        winner = 1;
    }

    room.players.forEach((player, index) => {

        io.to(player.socketId).emit("gameOver", {

            winner: winner === index,

            scores: room.players.map(
                p => p.hp
            )

        });

    });
}


/* =========================
   SOCKET.IO
========================= */

io.on("connection", (socket) => {

    console.log("Player connected:", socket.id);


    /* CREATE ROOM */

    socket.on("createRoom", (data) => {

        const roomCode =
            Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();

        rooms[roomCode] = {

            id: roomCode,

            players: [],

            question: 0,

            answers: {},

            timeLeft: 15,

            timer: null,

            finishedQuestion: false
        };


        const player = {

            socketId: socket.id,

            name:
                data.name ||
                "بازیکن ۱",

            hp: 100,

            combo: 0,

            shield: false,

            doubleAttack: false,

            powers: {

                shield: true,

                double: true,

                fifty: true,

                heal: true,

                fast: true

            }

        };


        rooms[roomCode].players.push(player);

        socket.join(roomCode);

        socket.roomCode = roomCode;

        socket.playerIndex = 0;


        socket.emit("roomCreated", {

            roomCode: roomCode

        });


        console.log(
            "Room created:",
            roomCode
        );
    });


    /* JOIN ROOM */

    socket.on("joinRoom", (data) => {

        const roomCode =
            String(data.roomCode || "")
                .toUpperCase();

        const room =
            rooms[roomCode];


        if (!room) {

            socket.emit("error", {

                message:
                    "این اتاق پیدا نشد."

            });

            return;
        }


        if (room.players.length >= 2) {

            socket.emit("error", {

                message:
                    "این اتاق پر است."

            });

            return;
        }


        const player = {

            socketId: socket.id,

            name:
                data.name ||
                "بازیکن ۲",

            hp: 100,

            combo: 0,

            shield: false,

            doubleAttack: false,

            powers: {

                shield: true,

                double: true,

                fifty: true,

                heal: true,

                fast: true

            }

        };


        room.players.push(player);

        socket.join(roomCode);

        socket.roomCode = roomCode;

        socket.playerIndex = 1;


        io.to(roomCode).emit("playerJoined", {

            enemyName:
                player.name

        });


        /* START */

        setTimeout(() => {

            if (
                rooms[roomCode] &&
                room.players.length === 2
            ) {

                room.players.forEach(
                    (p, index) => {

                        io.to(p.socketId)
                            .emit("gameStart", {

                                enemyName:
                                    room.players[
                                        1 - index
                                    ].name

                            });

                    }
                );

                sendQuestion(room);
            }

        }, 1000);

    });

    

    /* ANSWER */

    socket.on("answer", (data) => {

        const room =
            rooms[socket.roomCode];

        if (!room) {
            return;
        }

        const index =
            socket.playerIndex;


        if (
            room.answers[index] !== undefined
        ) {

            return;
        }


        room.answers[index] =
            Number(data.answer);


        socket.emit(
            "answerReceived"
        );


        const question =
            questions[room.question];


        if (
            Number(data.answer) ===
            question.correct
        ) {

            socket.emit(
                "answerResult",
                {
                    
              
                correct: true,
                    correctIndex: question.correct
                    damage: 0
                }
            );

        } else {

            socket.emit(
                "answerResult",
                {
                    correct: false,
                    correctIndex: question.correct
                    damage: 0
                }
            );
        }


        if (
            room.answers[0] !== undefined &&
            room.answers[1] !== undefined
        ) {

            finishQuestion(room);

        }

    });


    /* TIME UP */

    socket.on("timeUp", () => {

        const room =
            rooms[socket.roomCode];

        if (!room) {
            return;
        }

        if (
            room.answers[0] !== undefined &&
            room.answers[1] !== undefined
        ) {

            finishQuestion(room);

        }

    });


    /* POWERS */

    socket.on("usePower", (data) => {

        const room =
            rooms[socket.roomCode];

        if (!room) {
            return;
        }

        const player =
            room.players[socket.playerIndex];

        const power =
            data.power;


        if (!player.powers[power]) {

            socket.emit("powerResult", {

                message:
                    "❌ این قدرت قبلاً استفاده شده."

            });

            return;
        }


        player.powers[power] = false;


        /* SHIELD */

        if (power === "shield") {

            player.shield = true;

            socket.emit("powerResult", {

                message:
                    "🛡️ Shield فعال شد!"

            });

            return;
        }


        /* HEAL */

        if (power === "heal") {

            player.hp += 20;

            if (player.hp > 100) {
                player.hp = 100;
            }

            socket.emit("powerResult", {

                myHP: player.hp,

                enemyHP:
                    room.players[
                        1 - socket.playerIndex
                    ].hp,

                message:
                    "💚 20 HP بازیابی شد!"

            });

            return;
        }


        /* DOUBLE ATTACK */

        if (power === "double") {

            player.doubleAttack = true;

            socket.emit("powerResult", {

                message:
                    "⚔️ Double Attack آماده شد!"

            });

            return;
        }


        /* FAST ATTACK */

        if (power === "fast") {

            const opponent =
                room.players[
                    1 - socket.playerIndex
                ];

            if (!opponent.shield) {

                opponent.hp -= 10;

                if (opponent.hp < 0) {
                    opponent.hp = 0;
                }

            } else {

                opponent.shield = false;
            }

            socket.emit("powerResult", {

                message:
                    "⚡ حمله سریع انجام شد!"

            });


            room.players.forEach(
                (p, index) => {

                    io.to(p.socketId)
                        .emit("hpUpdate", {

                            myHP: p.hp,

                            enemyHP:
                                room.players[
                                    1 - index
                                ].hp

                        });

                }
            );


            if (opponent.hp <= 0) {

                finishGame(room);

            }

        }

    });


    /* DISCONNECT */

    socket.on("disconnect", () => {

        console.log(
            "Player disconnected:",
            socket.id
        );


        const roomCode =
            socket.roomCode;

        if (!roomCode) {
            return;
        }


        const room =
            rooms[roomCode];

        if (!room) {
            return;
        }


        io.to(roomCode).emit(
            "opponentLeft"
        );


        if (room.timer) {

            clearInterval(
                room.timer
            );

        }


        delete rooms[roomCode];

    });

});


/* =========================
   SERVER
========================= */

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () => {

        console.log(
            "Battle Arena server started on port "
            + PORT
        );

    }
);
