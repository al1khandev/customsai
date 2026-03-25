import time
import subprocess
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class GitAutoSync(FileSystemEventHandler):
    def __init__(self, repo_path):
        self.repo_path = repo_path
        self.last_sync = 0

    def on_any_event(self, event):
        if event.is_directory:
            return
        if '.git' in event.src_path:
            return
        now = time.time()
        if now - self.last_sync < 5:
            return
        self.last_sync = now
        self.sync()

    def sync(self):
        print("🔄 Изменения обнаружены, синхронизирую...")
        subprocess.run(['git', 'add', '.'], cwd=self.repo_path)
        subprocess.run(['git', 'commit', '-m', 'auto: sync changes'], cwd=self.repo_path)
        result = subprocess.run(['git', 'push'], cwd=self.repo_path)
        if result.returncode == 0:
            print("✅ Успешно запушено в GitHub")
        else:
            print("❌ Ошибка при push")

if __name__ == "__main__":
    import os
    path = os.path.dirname(os.path.abspath(__file__))
    print(f"👀 Слежу за папкой: {path}")
    handler = GitAutoSync(path)
    observer = Observer()
    observer.schedule(handler, path, recursive=True)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
