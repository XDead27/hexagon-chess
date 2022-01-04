//@ts-check

const express = require("express");
const http = require("http");
const websocket = require("ws");

const indexRouter = require("./routes/index");
const messages = require("./public/javascripts/messages");

const gameStatus = require("./statTracker");
const Game = require("./game");
const { PlayerType, PositionChecker, Position } = require("./public/javascripts/utils");

if(process.argv.length < 3) {
  console.log("Error: expected a port as argument (eg. 'node app.js 3000').");
  process.exit(1);
}
const port = process.argv[2];
const app = express();

app.set("view engine", "ejs");
app.use(express.static(__dirname + "/public"));

app.get("/play", indexRouter);
app.get("/", indexRouter);

const server = http.createServer(app);
const wss = new websocket.Server({ server });

const websockets = {}; //property: websocket, value: game

/*
 * regularly clean up the websockets object
 */
setInterval(function() {
  for (let i in websockets) {
    if (Object.prototype.hasOwnProperty.call(websockets,i)) {
      let gameObj = websockets[i];
      //if the gameObj has a final status, the game is complete/aborted
      if (gameObj.finalStatus != null) {
        delete websockets[i];
      }
    }
  }
}, 50000);

// TODO: make into a room system
let currentGame = new Game(gameStatus.gamesInitialized++);
let connectionID = 0; //each websocket receives a unique ID

wss.on("connection", function connection(ws) {
  /*
   * two-player game: every two players are added to the same game
   */
  const con = ws;
  con["id"] = connectionID++;
  const playerType = currentGame.addPlayer(con);
  websockets[con["id"]] = currentGame;

  console.log(
    `[GAME ${currentGame.id}][INFO] Player ${con["id"]} placed in game ${currentGame.id} as ${playerType}`
  );

  /*
   * inform the client about its assigned player type
   */
  con.send(playerType == PlayerType.WHITE ? messages.S_PLAYER_WHITE : messages.S_PLAYER_BLACK);

  /**
   * send the blank game data to the players
   */
  let gameData = messages.O_GAME_DATA;
  gameData.data = JSON.stringify(currentGame.gameData);
  con.send(JSON.stringify(gameData));

 

  /*
   * once we have two players, there is no way back;
   * a new game object is created;
   * if a player now leaves, the game is aborted (player is not preplaced)
   */
  if (currentGame.hasTwoConnectedPlayers()) {
     /**
     * WHITE player starts
     */
    currentGame.playerWhite.send(messages.S_MAKE_A_MOVE);
    currentGame.playerBlack.send(messages.S_WAIT_FOR_TURN);
    currentGame.setStatus("WHITE MOVES");
    console.log(`[GAME ${currentGame.id}][INFO] PASSED TURN TO WHITE`)

    currentGame = new Game(gameStatus.gamesInitialized++);
  }

  /*
   * message coming in from a player:
   *  1. determine the game object
   *  2. determine the opposing player OP
   *  3. send the message to OP
   */
  con.on("message", function incoming(message) {
    const oMsg = JSON.parse(message.toString());

    const gameObj = websockets[con["id"]];
    const gameObjData = gameObj.gameData;
    const isPlayerWhite = gameObj.playerWhite == con ? 1 : 0;

    if(oMsg.type == messages.T_MADE_MOVE) {
      if(isPlayerWhite == (gameObjData.turn + 1 % 2)) {
        let data = JSON.parse(oMsg.data);

        let p1 = Position.fromObj(data.p1);
        let p2 = Position.fromObj(data.p2)

        let onBoardMove = PositionChecker.isPositionOnBoard(p1) && 
                          PositionChecker.isPositionOnBoard(p2);

        let legalMove = PositionChecker.checkPosition(p1, p2, gameObjData.gameBoard);

        if (!onBoardMove || !legalMove) {
          isPlayerWhite ? gameObj.playerWhite.send(messages.T_ILLEGAL_MOVE) 
                        : gameObj.playerBlack.send(messages.T_ILLEGAL_MOVE);
            
          return;
        }

        gameObjData.performMove(p1, p2);

        if(false) {
          // check for win conditions
          let gameOverMsg = messages.O_GAME_OVER;
          gameOverMsg.data = isPlayerWhite ? PlayerType.WHITE : PlayerType.BLACK;
          gameObj.playerWhite.send(JSON.stringify(gameOverMsg));
          gameObj.playerBlack.send(JSON.stringify(gameOverMsg));

          gameObj.setStatus(isPlayerWhite ? PlayerType.WHITE : PlayerType.BLACK);
          return;
        }

        gameObjData.turn++;

        let update = messages.O_GAME_DATA;
        update.data = JSON.stringify(gameObjData);

        gameObj.playerWhite.send(JSON.stringify(update));
        gameObj.playerBlack.send(JSON.stringify(update));

        if(isPlayerWhite) {
          gameObj.playerBlack.send(messages.S_MAKE_A_MOVE);
          gameObj.playerWhite.send(messages.S_WAIT_FOR_TURN);
          gameObj.setStatus("BLACK MOVES");
        }
        else {
          gameObj.playerWhite.send(messages.S_MAKE_A_MOVE);
          gameObj.playerBlack.send(messages.S_WAIT_FOR_TURN);
          gameObj.setStatus("WHITE MOVES");
        }

      }
    }

    // if (isPlayerWhite) {
    //   /*
    //    * player A cannot do a lot, just send the target word;
    //    * if player B is already available, send message to B
    //    */
    //   if (oMsg.type == messages.T_TARGET_WORD) {
    //     gameObj.setWord(oMsg.data);

    //     if (gameObj.hasTwoConnectedPlayers()) {
    //       gameObj.playerBlack.send(message);
    //     }
    //   }
    // } else {
    //   /*
    //    * player B can make a guess;
    //    * this guess is forwarded to A
    //    */
    //   if (oMsg.type == messages.T_MAKE_A_GUESS) {
    //     gameObj.playerWhite.send(message);
    //     gameObj.setStatus("CHAR GUESSED");
    //   }

    //   /*
    //    * player B can state who won/lost
    //    */
    //   if (oMsg.type == messages.T_GAME_WON_BY) {
    //     gameObj.setStatus(oMsg.data);
    //     //game was won by somebody, update statistics
    //     gameStatus.gamesCompleted++;
    //   }
    // }
  });

  con.on("close", function(code) {
    /*
     * code 1001 means almost always closing initiated by the client;
     * source: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
     */
    console.log(`${con["id"]} disconnected ...`);

    if (code == 1001) {
      /*
       * if possible, abort the game; if not, the game is already completed
       */
      const gameObj = websockets[con["id"]];

      if (gameObj.isValidTransition(gameObj.gameState, "ABORTED")) {
        gameObj.setStatus("ABORTED");
        gameStatus.gamesAborted++;

        /*
         * determine whose connection remains open;
         * close it
         */
        try {
          gameObj.playerWhite.close();
          gameObj.playerWhite = null;
        } catch (e) {
          console.log("Player WHITE closing: " + e);
        }

        try {
          gameObj.playerBlack.close();
          gameObj.playerBlack = null;
        } catch (e) {
          console.log("Player BLACK closing: " + e);
        }
      }
    }
  });
});

server.listen(port);