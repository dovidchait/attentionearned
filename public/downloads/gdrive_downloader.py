#!/usr/bin/env python3
"""
Google Drive Bulk Downloader — free tool from Attention Earned.
https://www.attentionearned.com/free-resources

Standalone Windows GUI. No Google Cloud Console or API credentials needed.
Uses rclone (https://rclone.org, MIT licensed) under the hood. The first run
downloads rclone and does a one-time browser sign-in; after that it's automatic.

Settings and the saved Google sign-in live in %LOCALAPPDATA%\\GDriveDownloader.
"""

import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import tkinter as tk
import urllib.request
import zipfile
from pathlib import Path
from tkinter import ttk, filedialog, messagebox, scrolledtext

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_NAME = "GDriveDownloader"
_base = os.environ.get("LOCALAPPDATA") or str(Path.home())
TOOL_DIR = Path(_base) / APP_NAME
RCLONE_EXE = TOOL_DIR / "rclone.exe"
RCLONE_CONF = TOOL_DIR / "rclone.conf"
RCLONE_REMOTE = "gdrive"
RCLONE_DOWNLOAD_URL = "https://downloads.rclone.org/rclone-current-windows-amd64.zip"

# Hide the console window rclone would otherwise pop up from a --windowed exe.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def extract_folder_id(url_or_id: str) -> str:
    """Extract folder ID from a Drive URL or return the string as-is."""
    url_or_id = url_or_id.strip()
    m = re.search(r"/folders/([a-zA-Z0-9_-]+)", url_or_id)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", url_or_id)
    if m:
        return m.group(1)
    if re.match(r"^[a-zA-Z0-9_-]{20,}$", url_or_id):
        return url_or_id
    return ""


def rclone_cmd(*args):
    return [str(RCLONE_EXE), "--config", str(RCLONE_CONF)] + list(args)


def run_hidden(cmd, **kw):
    kw.setdefault("stdin", subprocess.DEVNULL)
    return subprocess.run(cmd, creationflags=NO_WINDOW, **kw)


def config_is_valid() -> bool:
    try:
        text = RCLONE_CONF.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return f"[{RCLONE_REMOTE}]" in text and "token" in text


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Google Drive Bulk Downloader — Attention Earned")
        self.resizable(True, True)
        self.minsize(620, 520)
        self._running = False
        self._stop_requested = False
        self._proc = None
        self._logq: "queue.Queue[str | None]" = queue.Queue()
        self._build_ui()
        self.after(100, self._drain_log)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # -----------------------------------------------------------------------
    # UI
    # -----------------------------------------------------------------------
    def _build_ui(self):
        pad = {"padx": 10, "pady": 4}

        frm_top = ttk.LabelFrame(self, text="Source (Google Drive)")
        frm_top.pack(fill="x", **pad)
        ttk.Label(frm_top, text="Folder URL or ID:").grid(row=0, column=0, sticky="w", padx=6, pady=4)
        self.var_url = tk.StringVar()
        ttk.Entry(frm_top, textvariable=self.var_url, width=60).grid(row=0, column=1, sticky="ew", padx=6, pady=4)
        frm_top.columnconfigure(1, weight=1)

        frm_dest = ttk.LabelFrame(self, text="Destination (local folder)")
        frm_dest.pack(fill="x", **pad)
        ttk.Label(frm_dest, text="Save to:").grid(row=0, column=0, sticky="w", padx=6, pady=4)
        self.var_dest = tk.StringVar()
        ttk.Entry(frm_dest, textvariable=self.var_dest, width=52).grid(row=0, column=1, sticky="ew", padx=6, pady=4)
        ttk.Button(frm_dest, text="Browse…", command=self._browse).grid(row=0, column=2, padx=6, pady=4)
        frm_dest.columnconfigure(1, weight=1)

        frm_opts = ttk.LabelFrame(self, text="Options")
        frm_opts.pack(fill="x", **pad)
        self.var_mode = tk.StringVar(value="missing")
        ttk.Radiobutton(
            frm_opts,
            text="Download missing files only (skip any filename already anywhere in the destination)",
            variable=self.var_mode, value="missing",
        ).pack(anchor="w", padx=8, pady=2)
        ttk.Radiobutton(
            frm_opts,
            text="Download everything (mirror folder structure; unchanged files are skipped)",
            variable=self.var_mode, value="all",
        ).pack(anchor="w", padx=8, pady=2)

        ttk.Label(frm_opts, text="Filename filter, e.g. *.mp4 (not case-sensitive, blank = all files):").pack(
            anchor="w", padx=8, pady=(4, 0))
        self.var_filter = tk.StringVar(value="")
        ttk.Entry(frm_opts, textvariable=self.var_filter, width=30).pack(anchor="w", padx=8, pady=(0, 4))

        ttk.Label(frm_opts, text="Parallel transfers:").pack(anchor="w", padx=8, pady=(4, 0))
        self.var_transfers = tk.StringVar(value="4")
        ttk.Spinbox(frm_opts, from_=1, to=8, textvariable=self.var_transfers, width=4).pack(
            anchor="w", padx=8, pady=(0, 6))

        frm_btns = ttk.Frame(self)
        frm_btns.pack(fill="x", padx=10, pady=4)
        self.btn_run = ttk.Button(frm_btns, text="▶  Start Download", command=self._start)
        self.btn_run.pack(side="left", padx=(0, 6))
        self.btn_stop = ttk.Button(frm_btns, text="■  Stop", command=self._stop, state="disabled")
        self.btn_stop.pack(side="left", padx=(0, 6))
        self.btn_auth = ttk.Button(frm_btns, text="Sign in again / switch Google account", command=self._reauth)
        self.btn_auth.pack(side="left")

        ttk.Label(self, text="Log:").pack(anchor="w", padx=10)
        self.log = scrolledtext.ScrolledText(self, height=14, state="disabled", wrap="word", font=("Consolas", 9))
        self.log.pack(fill="both", expand=True, padx=10, pady=(0, 10))

    def _browse(self):
        d = filedialog.askdirectory(title="Select destination folder")
        if d:
            self.var_dest.set(d)

    # -----------------------------------------------------------------------
    # Logging (thread-safe: workers enqueue, the Tk thread drains)
    # -----------------------------------------------------------------------
    def _log(self, msg: str):
        self._logq.put(msg)

    def _log_clear(self):
        self._logq.put(None)

    def _drain_log(self):
        try:
            while True:
                msg = self._logq.get_nowait()
                self.log.configure(state="normal")
                if msg is None:
                    self.log.delete("1.0", "end")
                else:
                    self.log.insert("end", msg + "\n")
                    self.log.see("end")
                self.log.configure(state="disabled")
        except queue.Empty:
            pass
        self.after(100, self._drain_log)

    def _set_busy(self, busy: bool):
        def apply():
            self.btn_run.configure(state="disabled" if busy else "normal")
            self.btn_auth.configure(state="disabled" if busy else "normal")
            self.btn_stop.configure(state="normal" if busy else "disabled")
        self.after(0, apply)

    # -----------------------------------------------------------------------
    # Setup helpers (run on worker threads)
    # -----------------------------------------------------------------------
    def _ensure_rclone(self) -> bool:
        if RCLONE_EXE.exists():
            return True
        self._log("First run: downloading rclone (about 20 MB)…")
        TOOL_DIR.mkdir(parents=True, exist_ok=True)
        zip_path = TOOL_DIR / "rclone.zip"
        extract_dir = TOOL_DIR / "extracted"
        try:
            urllib.request.urlretrieve(RCLONE_DOWNLOAD_URL, zip_path)
            self._log("Extracting…")
            with zipfile.ZipFile(zip_path, "r") as zf:
                member = next((m for m in zf.namelist() if m.endswith("/rclone.exe")), None)
                if not member:
                    self._log("ERROR: rclone.exe not found in the download.")
                    return False
                zf.extract(member, extract_dir)
            shutil.move(str(extract_dir / member), str(RCLONE_EXE))
            self._log("rclone ready.\n")
            return True
        except Exception as e:
            self._log(f"ERROR downloading rclone: {e}")
            return False
        finally:
            zip_path.unlink(missing_ok=True)
            shutil.rmtree(extract_dir, ignore_errors=True)

    def _ensure_auth(self) -> bool:
        if config_is_valid():
            return True
        RCLONE_CONF.unlink(missing_ok=True)
        self._log("One-time Google sign-in: a browser window will open.")
        self._log("Sign in, click Allow, then come back here.\n")
        # `config create` runs the browser OAuth flow itself. Read-only scope:
        # this tool never modifies anything in your Drive.
        result = run_hidden(
            rclone_cmd("config", "create", RCLONE_REMOTE, "drive", "scope", "drive.readonly"),
            capture_output=True, text=True,
        )
        if result.returncode != 0 or not config_is_valid():
            RCLONE_CONF.unlink(missing_ok=True)
            self._log("ERROR: Google sign-in did not complete.")
            if result.stderr:
                self._log(result.stderr.strip()[-1500:])
            return False
        self._log("Signed in. You won't need to do this again on this PC.\n")
        return True

    def _reauth(self):
        if self._running:
            return
        RCLONE_CONF.unlink(missing_ok=True)
        self._log("Removed saved sign-in.")
        self._running = True
        self._set_busy(True)

        def work():
            try:
                if self._ensure_rclone():
                    self._ensure_auth()
            finally:
                self._running = False
                self._set_busy(False)

        threading.Thread(target=work, daemon=True).start()

    # -----------------------------------------------------------------------
    # Download logic
    # -----------------------------------------------------------------------
    def _start(self):
        if self._running:
            return

        url = self.var_url.get().strip()
        dest = self.var_dest.get().strip()
        mode = self.var_mode.get()
        glob_filter = self.var_filter.get().strip()
        transfers = self.var_transfers.get().strip()
        if not transfers.isdigit() or not 1 <= int(transfers) <= 16:
            transfers = "4"

        if re.search(r"photos\.google\.com|photos\.app\.goo\.gl", url, re.I):
            messagebox.showerror(
                "Google Photos link",
                "This is a Google Photos link, not a Drive folder.\n\n"
                "Google doesn't let any outside app download Photos albums.\n"
                "Open the link in your browser and use the ⋮ menu → Download all,\n"
                "or ask the sender to share the files in a Drive folder instead.",
            )
            return
        folder_id = extract_folder_id(url)
        if not folder_id:
            messagebox.showerror("Missing input", "Enter a valid Google Drive folder URL or ID.")
            return
        if not dest:
            messagebox.showerror("Missing input", "Choose a destination folder.")
            return
        if not Path(dest).is_dir():
            messagebox.showerror("Not found", f"Destination folder does not exist:\n{dest}")
            return

        self._log_clear()
        self._log(f"Folder ID  : {folder_id}")
        self._log(f"Destination: {dest}")
        self._log(f"Mode       : {mode}")
        self._log(f"Filter     : {glob_filter or '(all files)'}\n")

        self._running = True
        self._stop_requested = False
        self._set_busy(True)
        threading.Thread(
            target=self._run_worker,
            args=(folder_id, dest, mode, glob_filter, transfers),
            daemon=True,
        ).start()

    def _run_worker(self, folder_id, dest, mode, glob_filter, transfers):
        try:
            if not self._ensure_rclone() or not self._ensure_auth():
                return

            dest_path = Path(dest)
            filter_args = []
            if glob_filter:
                filter_args += ["--ignore-case", "--include", glob_filter]

            if mode == "missing":
                self._log("Scanning Drive folder (including subfolders)…")
                drive_files = self._list_drive(folder_id, filter_args)
                if drive_files is None:
                    return
                self._log(f"Drive has {len(drive_files)} matching files.")

                local_names = {f.name.lower() for f in dest_path.rglob("*") if f.is_file()}
                missing = [p for p in drive_files if p.rsplit("/", 1)[-1].lower() not in local_names]
                self._log(f"Destination has {len(local_names)} files. Missing: {len(missing)}\n")
                if not missing:
                    self._log("Nothing to download — you're already up to date.")
                    return

                # --files-from takes literal paths, so names with [ ] * { } are safe.
                list_path = TOOL_DIR / "files_tmp.txt"
                list_path.write_text("\n".join(missing) + "\n", encoding="utf-8")
                filter_args = ["--files-from-raw", str(list_path)]

            if self._stop_requested:
                return

            self._log("Starting download…\n")
            cmd = rclone_cmd(
                "copy", f"{RCLONE_REMOTE}:", str(dest_path),
                "--drive-root-folder-id", folder_id,
                "--transfers", transfers,
                "--stats", "5s", "--stats-one-line", "--stats-log-level", "NOTICE",
                "--log-level", "INFO",
                *filter_args,
            )
            self._proc = subprocess.Popen(
                cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1, creationflags=NO_WINDOW,
            )
            for line in self._proc.stdout:
                self._log(line.rstrip())
            self._proc.wait()

            if self._stop_requested:
                self._log("\n■ Stopped. Run again to resume — finished files are skipped.")
            elif self._proc.returncode == 0:
                self._log("\n✓ Done! All files downloaded.")
            else:
                self._log(f"\n⚠ rclone exited with code {self._proc.returncode}. "
                          "Some files may have failed — run again to retry them.")
        except Exception as e:
            self._log(f"\nERROR: {e}")
        finally:
            self._proc = None
            self._running = False
            self._set_busy(False)

    def _list_drive(self, folder_id: str, filter_args):
        cmd = rclone_cmd("lsf", f"{RCLONE_REMOTE}:", "--drive-root-folder-id", folder_id,
                         "--files-only", "-R", *filter_args)
        result = run_hidden(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if result.returncode != 0:
            self._log(f"ERROR listing Drive folder:\n{result.stderr.strip()[-1500:]}")
            self._log("Check the link, and that the signed-in Google account can open it.")
            return None
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]

    def _stop(self):
        self._stop_requested = True
        if self._proc:
            self._proc.terminate()
        self._log("\nStopping…")

    def _on_close(self):
        if self._proc:
            self._proc.terminate()
        self.destroy()


if __name__ == "__main__":
    App().mainloop()
