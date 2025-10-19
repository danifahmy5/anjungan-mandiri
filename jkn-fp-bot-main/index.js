// @ts-check
import bot from 'node-autoit-koffi';
import { createServer } from 'node:http';
import qs from 'node:querystring';
import { setTimeout } from 'node:timers/promises';
import pkg from './package.json' with { type: 'json' };

const host = `127.0.0.1`; // bind the server to the loopback interface so we don't expose it
const port = Number(process.env.SERVER_PORT) || 3000;
const fp_win_title = process.env.FP_WIN_TITLE || 'Aplikasi Registrasi Sidik Jari';
const fp_ins_path = process.env.FP_INS_PATH || 'C:\\Program Files (x86)\\BPJS Kesehatan\\Aplikasi Sidik Jari BPJS Kesehatan\\After.exe';

const server = createServer((req, res) => {
	// allow cors
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

	/** @param {Error} error  */
	function handle_error(error) {
		console.error(error);
		json(500, { message: error?.message || `Internal server error` });
	}

	/**
	 * @param {number} status
	 * @param {any =} data
	 */
	function json(status, data) {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		if (!data) return res.end();
		res.end(JSON.stringify(data));
	}

	try {
		const url = new URL(req.url || '/', `http://${host}`);
		if (url.pathname === '/' && req.method === 'GET') {
			// service info
			json(200, { message: pkg.description });
		} else if (url.pathname === '/' && req.method === 'POST') {
			// apm bot service
			let body = '';
			req.on('data', (chunk) => (body += chunk.toString()));
			req.on('end', () => {
				const form_data = qs.parse(body);
				const username = form_data['username'];
				const password = form_data['password'];
				const card_number = form_data['card_number'];
				const exit = form_data['exit'] === 'true';
				const wait = form_data['wait'];

				if (!username || !password || !card_number) {
					return json(400, {
						message: `username, password, and card_number are required fields`
					});
				}

				run_bot({ username, password, card_number, exit, wait })
					.then(() => json(201))
					.catch((e) => handle_error(e));
			});
		} else {
			json(404, { message: `Not found` });
		}
	} catch (error) {
		handle_error(error);
	}
});

server.on('error', (err) => {
	// might to try restarting the server or take other actions
	console.error('Server error:', err);
});

server.listen(port, host, () => {
	console.log(`Server running at http://${host}:${port}`);
});

async function run_bot({ username, password, card_number, exit, wait }) {
	// open or activate the application window
	const already_open = await bot.winExists(fp_win_title);
	if (!already_open) {
		await bot.run(fp_ins_path);
		await bot.winWait(fp_win_title); // wait for the application window to appear
	}

	await bot.winActivate(fp_win_title); // activate the application window
	await bot.winWaitActive(fp_win_title); // wait for the application to be in focus

	if (exit) {
		await bot.winSetOnTop(fp_win_title, '', 1); // set window on top
	}

	// get the position and size of the window
	const win_pos = await bot.winGetPos(fp_win_title);
	if (!win_pos) throw new Error('Failed to get window position');

	// use top and left positions to calculate absolute points
	const { top, left } = win_pos;

	// login if window just open up
	if (already_open) {
		// focus number input
		await bot.mouseMove(left + 223, top + 121, 0);
		await bot.mouseClick('left');

		// clear number input
		await bot.send('^a');
		await bot.send('{BACKSPACE}');
	} else {
		// focus to the first input
		await bot.mouseMove(left + 223, top + 179, 0);
		await bot.mouseClick('left');

		await setTimeout(1000);

		// clear and enter the username
		await bot.send('^a');
		await bot.send('{BACKSPACE}');
		await bot.send(username);

		await bot.send('{TAB}');

		// clear and enter the password
		await bot.send('^a');
		await bot.send('{BACKSPACE}');
		await bot.send(password);

		// hit enter key for login
		await bot.send('{ENTER}');

		await setTimeout(+wait || 3_593);
	}

	// send card number
	await bot.send(card_number);

	if (exit) {
		// wait for window to close
		await bot.winWaitClose(fp_win_title);
	}
}
