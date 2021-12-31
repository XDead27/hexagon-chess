/* eslint-disable no-undef */

const clickSound = new Audio("../data/click.wav");

/**
 * GameHandler object that takes care of displaying the changes
 * made by receiving a new GameState
 */
class GameHandler {
    /**
	 * @param {GameState} initialGameState
	 * @param {VisibleGameBoard} hexagonalBoard 
	 * @param {TimerBar} timerBar 
	 * @param {StatusBar} statusBar 
	 * @param {number} currentTurn 
	 * @param {WebSocket} socket 
	 */
	constructor(initialGameState, hexagonalBoard, timerBar, statusBar, socket) {
        this.playerType = null;
        this.gameState = initialGameState;
        this.visibleGameBoard = hexagonalBoard;
        this.timerBar = timerBar;
        this.statusBar = statusBar;
        this.socket = socket;

        this.currentSelectedPosition = null;
    }
    /**
   * Initializes the board with starting positions.
   */
    initializeBoard() {
        this.visibleGameBoard.initializeStartingPositions();
    }
    /**
   * Retrieve the player type.
   * @returns {PlayerType} player type
   */
    getPlayerType() {
        return this.playerType;
    }
    /**
   * Set the player type.
   * @param {PlayerType} p player type to set
   */
    setPlayerType(p) {
        this.playerType = p;
    }
    /**
   * Returns the player type based on current turn
   *
   * @returns {PlayerType} player type
   */
    getTurnPlayerType() {
        return this.gameState.turn % 2 == 0 ? PlayerType.WHITE : PlayerType.BLACK;
    }

    /**
   * Sets the current cell position selection
   * and marks all possible moves of that piece on the board
   * 
   * @param {Position} p 
   */
    setCurrentSelectedPosition(p) {
        this.currentSelectedPosition = p;
		this.visibleGameBoard.selectCell(p);

		this.visibleGameBoard.cells.forEach(function(el) {
			let obj = JSON.parse(e.target["title"]);
            let possibleMove = new Position(obj.x, obj.y, obj.z);

			if(PositionChecker.checkPosition(p, possibleMove, this.gameState.gameBoard)) {
				this.visibleGameBoard.makeCellAvailable(possibleMove);
			}
		});
    }

    /**
   * Deselects the current cell and makes the rest
   * of the cells unavailable
   */
    deselectPosition() {
        this.currentSelectedPosition = null;
		this.visibleGameBoard.deselectAllCells();
    }

    /**
   * @returns {boolean} if there is a position selected
   */
    isPositionSelected() {
        return this.currentSelectedPosition != null;
    }

    /**
   * Update the game state given the cell that was just clicked.
   * @param {Position} p
   */
    updatePosition(p) {

		// Check if the position is a valid one
        if (!PositionChecker.isPositionOnTheField(p)) {
			this.statusBar.setStatus(Status.notNice);
            return;
        }

		// If the user has already selected a piece before, then send the new movement
		if(this.isPositionSelected()) {
			let previousPosition = this.currentSelectedPosition;
			this.deselectPosition();

			// If its the same position as before, just consider the piece deselected
			if(previousPosition.equals(p)) return;

			// If the move is invalid, print a message
			if(!PositionChecker.checkPosition(previousPosition, p, this.gameState.gameBoard)) {
				this.statusBar.setStatus(Status.invalidMove);
				return;
			}

			// Move the piece to the desired position (even if it may be temporary)
			let selectedPieceType = this.gameState.gameBoard.getPieceAtPosition(previousPosition)[0];
			let selectedPieceColor = this.gameState.gameBoard.getPieceAtPosition(previousPosition)[1];

			this.visibleGameBoard.addPieceToCell(previousPosition, null, null);
			this.visibleGameBoard.addPieceToCell(p, selectedPieceType, selectedPieceColor);

			// Send the movement to the server
			let moveMsg = Messages.O_MADE_MOVE;
			moveMsg.data = JSON.stringify({
				p1: previousPosition, 
				p2: p,
			});

			this.socket.send(JSON.stringify(moveMsg));

			// Notify the user that we are waiting for the server to respond
			this.statusBar.setStatus(Status.waitingServer);

			// Disable the cells after a move
			this.visibleGameBoard.disableAllCells();
		}
		// If not, select the clicked position
		else {
			this.setCurrentSelectedPosition(p);
		}
    }

	updateBoard() {
		let currentBoard = this.gameState.gameBoard;

		this.visibleGameBoard.cells.forEach(function() {
			let obj = JSON.parse(e.target["title"]);
            let cellPosition = new Position(obj.x, obj.y, obj.z);

			let boardCellPieceType = currentBoard.getPieceAtPosition(cellPosition)[0];
			let boardCellPieceColor = currentBoard.getPieceAtPosition(cellPosition)[1];

			this.visibleGameBoard.addPieceToCell(cellPosition, boardCellPieceType, boardCellPieceColor);
		});
	}

	updateBarData() {
		let whiteTime = this.gameState.whiteTime;
		let blackTime = this.gameState.blackTime;

		this.timerBar.setTimer(1, whiteTime);
		this.timerBar.setTimer(2, blackTime);
	}
}


// set everything up, including the WebSocket
(function setup() {
    const socket = new WebSocket(Setup.WEB_SOCKET_URL);

    /*
   * initialize all UI elements of the game:
   * - visible game board (i.e the actual hexagons that represent the board)
   * - status bar
   * - timer bar
   *
   * the GameHandler object coordinates everything
   */

    const gs = new GameState();
    gs.initialize();

    const vgb = new VisibleGameBoard();
    const sb = new StatusBar();
    const tb = new TimerBar();

    const gh = new GameHandler(gs, vgb, tb, sb, socket);

    socket.onmessage = function (event) {
        let incomingMsg = JSON.parse(event.data);

        // set player type
        if (incomingMsg.type == Messages.T_PLAYER_TYPE) {
            gh.setPlayerType(incomingMsg.data);
            // should be "WHITE" or "BLACK"

			gh.initializeBoard();
			vgb.disableAllCells();
			tb.setTimer(1, 0);
			tb.setTimer(2, 0);
			sb.setStatus(Status.waitingOpponent);

			if (gh.getPlayerType() == PlayerType.BLACK) {
				// maybe invert board, dunno?
			}
        }

		// When we get new data from the server we override the existent game state
		if (incomingMsg.type == Messages.T_GAME_DATA) {
			let newState = JSON.parse(incomingMsg.data);

			gh.gameState.fromObj(newState);

			gh.updateBarData();
			gh.updateBoard();
		}

		if (incomingMsg.type == Messages.T_MAKE_A_MOVE) {
			vgb.enableAllCells();
			sb.setStatus(Status.makeMove);
		}

		if (incomingMsg.type == Messages.T_ILLEGAL_MOVE) {
			vgb.enableAllCells();
			sb.setStatus(Status.invalidMove);
		}

		if (incomingMsg.type == Messages.T_WAIT_FOR_TURN) {
			vgb.disableAllCells();
			sb.setStatus(Status.waitingTurn);
		}

        // // Player B: wait for target word and then start guessing ...
        // if (incomingMsg.type == Messages.T_TARGET_WORD && gh.getPlayerType() == "B") {
        //     gh.setTargetWord(incomingMsg.data);

        //     sb.setStatus(Status["player2Intro"]);
        //     gh.initializeVisibleWordArray(); // initialize the word array, now that we have the word
        //     ab.initialize();
        //     vw.setWord(gh.getVisibleWordArray());
        // }

        // // Player A: wait for guesses and update the board ...
        // if (incomingMsg.type == Messages.T_MAKE_A_GUESS && gh.getPlayerType() == "A") {
        //     sb.setStatus(Status["guessed"] + incomingMsg.data);
        //     gh.updateGame(incomingMsg.data);
        // }
    };

    socket.onopen = function () {
        socket.send("{}");
    };

    // server sends a close event only if the game was aborted from some side
    socket.onclose = function () {
        if (gh.winner == null) {
            sb.setStatus(Status["aborted"]);
        }
    };

    socket.onerror = function () {};
})(); // execute immediately
