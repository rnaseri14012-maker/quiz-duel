const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server: server
});

app.use(express.static("public"));

const rooms = {};

const questions = [
    {
        q: "پایتخت ایران کدام شهر است؟",
        a: ["تهران", "شیراز", "تبریز", "اصفهان"],
        correct: 0
    },
    {
        q: "بزرگ‌ترین سیاره منظومه شمسی کدام است؟",
        a: ["زمین", "مریخ", "مشتری", "زحل"],
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

function send(ws, data) {

    if (ws.readyState === WebSocket.OPEN) {

        ws.send(JSON.stringify(data));

    }

}

function broadcast(room, data) {

    room.players.forEach(function(player) {

        send(player.ws, data);

    });

}

function sendQuestion(room) {

    const question =
        questions[room.question];

    room.answers = {};

    broadcast(room, {

        type: "question",

        number: room.question + 1,

        total: questions.length,

        question: question.q,

        answers: question.a

    });

}

wss.on("connection", function(ws) {

    ws.on("message", function(message) {

        let data;

        try {

            data = JSON.parse(message);

        } catch (error) {

            send(ws, {

                type: "error",

                message: "پیام نامعتبر است."

            });

            return;

        }

        // ساخت اتاق جدید

        if (data.type === "create") {

            const roomId =
                Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();

            rooms[roomId] = {

                players: [],

                question: 0,

                scores: [0, 0],

                answers: {}

            };

            rooms[roomId].players.push({

                ws: ws,

                name: data.name || "بازیکن ۱"

            });

            ws.room = roomId;

            ws.player = 0;

            send(ws, {

                type: "roomCreated",

                room: roomId

            });

            return;

        }

        // ورود بازیکن دوم

        if (data.type === "join") {

            const room =
                rooms[data.room];

            if (!room) {

                send(ws, {

                    type: "error",

                    message: "این اتاق پیدا نشد."

                });

                return;

            }

            if (room.players.length >= 2) {

                send(ws, {

                    type: "error",

                    message: "این اتاق پر است."

                });

                return;

            }

            room.players.push({

                ws: ws,

                name: data.name || "بازیکن ۲"

            });

            ws.room = data.room;

            ws.player = 1;

            broadcast(room, {

                type: "players",

                players: room.players.map(
                    function(player) {
                        return player.name;
                    }
                )

            });

            setTimeout(function() {

                sendQuestion(room);

            }, 1000);

            return;

        }

        // دریافت جواب

        if (data.type === "answer") {

            const room =
                rooms[ws.room];

            if (!room) return;

            if (
                room.answers[ws.player]
                !== undefined
            ) {

                return;

            }

            room.answers[ws.player] =
                Number(data.answer);

            send(ws, {

                type: "answerReceived"

            });

            // بررسی اینکه هر دو جواب داده‌اند

            if (
                room.answers[0]
                !== undefined &&
                room.answers[1]
                !== undefined
            ) {

                const question =
                    questions[room.question];

                // امتیاز بازیکن اول

                if (
                    room.answers[0]
                    === question.correct
                ) {

                    room.scores[0] += 10;

                }

                // امتیاز بازیکن دوم

                if (
                    room.answers[1]
                    === question.correct
                ) {

                    room.scores[1] += 10;

                }

                // ارسال نتیجه سؤال

                broadcast(room, {

                    type: "result",

                    correct:
                        question.correct,

                    scores:
                        room.scores

                });

                room.question++;

                if (
                    room.question
                    < questions.length
                ) {

                    setTimeout(function() {

                        sendQuestion(room);

                    }, 2000);

                } else {

                    setTimeout(function() {

                        broadcast(room, {

                            type: "gameOver",

                            scores:
                                room.scores

                        });

                    }, 2000);

                }

            }

        }

    });

    // وقتی بازیکن قطع شد

    ws.on("close", function() {

        const roomId =
            ws.room;

        if (
            !roomId ||
            !rooms[roomId]
        ) {

            return;

        }

        const room =
            rooms[roomId];

        broadcast(room, {

            type: "opponentLeft"

        });

    });

});

const PORT =
    process.env.PORT || 3000;

server.listen(PORT, function() {

    console.log(
        "Quiz server started on port "
        + PORT
    );

});
