const app = require('./app');
const { port } = require('./core/config');
const { checkDatabaseConnection, pool } = require('./core/config/database');

async function startServer() {
	let databaseConnected = false;

	try {
		await checkDatabaseConnection();
		databaseConnected = true;
	} catch (error) {
		const code = typeof error.code === 'string' ? error.code : 'CONNECTION_FAILED';
		console.error(`Database: NOT CONNECTED (${code})`);
	}

	const server = app.listen(port, () => {
		const baseUrl = `http://localhost:${port}`;
		console.log('\nEma Store Backend');
		console.log(`Database: ${databaseConnected ? 'CONNECTED' : 'NOT CONNECTED'}`);
		console.log(`API:      ${baseUrl}`);
		console.log(`Health:   ${baseUrl}/health\n`);
	});

	server.on('error', (error) => {
		const code = typeof error.code === 'string' ? error.code : 'LISTEN_FAILED';
		console.error(`Server: FAILED TO START (${code})`);
		process.exitCode = 1;
	});

	const shutdown = (signal) => {
		server.close(() => {
			pool.end().finally(() => {
				if (signal === 'SIGUSR2') {
					process.kill(process.pid, 'SIGUSR2');
				}
			});
		});
	};

	process.once('SIGINT', () => shutdown('SIGINT'));
	process.once('SIGTERM', () => shutdown('SIGTERM'));
	process.once('SIGUSR2', () => shutdown('SIGUSR2'));
}

startServer().catch((error) => {
	console.error('[server] failed to start');
	process.exitCode = 1;
});
