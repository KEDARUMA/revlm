import fs from 'fs';
import path from 'path';

async function run() {
  try {
    // Resolve PID file and stop the running example-server process.
    // PIDファイルから起動中のexample-serverを停止する。
    //
    // Why PID-based stop:
    // - `pnpm start` runs in a separate process.
    // - We need a stable way to locate and stop that process from another shell/test.
    // - start.ts writes `.example-server.pid` for this purpose.
    //
    // PIDで停止する理由:
    // - `pnpm start` は別プロセスで常駐する。
    // - 別シェル/テストから停止するにはプロセス特定手段が必要。
    // - start.ts が `.example-server.pid` を書き出してそれを実現する。
    const pidFile = process.env.EXAMPLE_SERVER_PID_FILE
      ? path.resolve(process.cwd(), process.env.EXAMPLE_SERVER_PID_FILE)
      : path.resolve(process.cwd(), '.example-server.pid');
    if (!fs.existsSync(pidFile)) {
      console.log('PID file not found. Example server may not be running.');
      process.exit(0);
    }
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = Number(raw);
    if (Number.isNaN(pid)) {
      console.log('PID file is invalid. Removing.');
      fs.unlinkSync(pidFile);
      process.exit(1);
    }
    try {
      // SIGTERM is preferred for graceful shutdown (start.ts traps it).
      // SIGTERMで停止（start.ts側でgraceful shutdownを行う）。
      process.kill(pid, 'SIGTERM');
    } catch (error: any) {
      if (error && error.code === 'ESRCH') {
        // Process already stopped; clean up PID file and warn.
        // 既に停止済みなのでPIDファイルを削除して警告を出す。
        //
        // ESRCH means "No such process".
        // Most commonly this happens when:
        // - the server already exited (e.g. previous run crashed), but PID file remains.
        //
        // ESRCH は「そのプロセスが存在しない」。
        // よくある原因:
        // - サーバが既に終了しているのにPIDファイルだけ残っている。
        fs.unlinkSync(pidFile);
        console.warn(`PID ${pid} not found (already stopped). Removed pid file.`);
        process.exit(0);
      }
      throw error;
    }
    fs.unlinkSync(pidFile);
    console.log('Example server stopped.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to stop example server', error);
    process.exit(1);
  }
}

run();
