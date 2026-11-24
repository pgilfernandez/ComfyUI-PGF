import asyncio
import base64
import ipaddress
import os
import subprocess
import sys
from pathlib import Path

from aiohttp import web
from server import PromptServer

WEB_DIRECTORY = "./web"
folder_picker_lock = asyncio.Lock()


def list_text_files(folder):
    if not folder.strip():
        return []

    directory = Path(folder.strip().strip('"')).expanduser()
    if not directory.is_absolute():
        raise ValueError("Enter an absolute folder path.")

    return sorted(
        (path for path in directory.iterdir()
         if path.suffix.lower() == ".txt" and path.is_file()),
        key=lambda path: (path.name.casefold(), path.name),
    )


@PromptServer.instance.routes.get("/pgf/text-files")
async def get_text_files(request):
    try:
        files = await asyncio.to_thread(list_text_files, request.query.get("folder", ""))
    except (OSError, ValueError, RuntimeError) as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"files": [path.name for path in files]})


@PromptServer.instance.routes.post("/pgf/pick-folder")
async def pick_folder(request):
    try:
        remote = ipaddress.ip_address(request.remote)
        remote = getattr(remote, "ipv4_mapped", None) or remote
    except ValueError:
        return web.json_response({"error": "Folder picker requires a local connection."}, status=403)
    if not remote.is_loopback:
        return web.json_response({"error": "Folder picker requires a local connection."}, status=403)

    if request.content_type != "application/json":
        return web.json_response({"error": "Expected a JSON request."}, status=415)
    try:
        body = await request.json()
        initial_folder = body["folder"]
        if not isinstance(initial_folder, str) or "\0" in initial_folder:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        return web.json_response({"error": "Invalid folder path."}, status=400)

    if folder_picker_lock.locked():
        return web.json_response({"error": "A folder picker is already open."}, status=409)

    async with folder_picker_lock:
        try:
            if sys.platform != "win32":
                return web.json_response({"error": "The native folder picker requires Windows."}, status=501)

            script = Path(__file__).with_name("_folder_picker.ps1")
            encoded_script = base64.b64encode(script.read_text(encoding="utf-8").encode("utf-16-le")).decode("ascii")
            env = {**os.environ, "PGF_FOLDER_PICKER_START": initial_folder.strip().strip('"')}
            result = await asyncio.to_thread(
                subprocess.run,
                ["powershell.exe", "-NoProfile", "-STA", "-EncodedCommand", encoded_script],
                capture_output=True,
                encoding="utf-8",
                check=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
                env=env,
                timeout=300,
            )
            folder = result.stdout or None
        except (OSError, ValueError, subprocess.SubprocessError):
            return web.json_response({"error": "Could not open the system folder picker."}, status=503)

    return web.json_response({"folder": folder})


class PGFLoadTextFile:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder": ("STRING", {"default": "", "tooltip": "Absolute folder path"}),
                "index": ("INT", {"default": 0, "min": 0, "max": 2147483647}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("text", "file_name", "index", "total")
    FUNCTION = "load"
    CATEGORY = "PGF/Text"

    @classmethod
    def IS_CHANGED(cls, folder, index):
        try:
            files = list_text_files(folder)
            if 0 <= index < len(files):
                path = files[index]
                stat = path.stat()
                return (str(path), stat.st_mtime_ns, stat.st_size, len(files))
        except (OSError, ValueError, RuntimeError):
            pass
        return float("nan")

    def load(self, folder, index):
        files = list_text_files(folder)
        total = len(files)
        if total == 0:
            return ("", "", index, 0)
        if not 0 <= index < total:
            raise ValueError(f"Index {index} is out of range for {total} text files.")

        path = files[index]
        return (path.read_text(encoding="utf-8-sig"), path.stem, index, total)


NODE_CLASS_MAPPINGS = {"PGFLoadTextFile": PGFLoadTextFile}
NODE_DISPLAY_NAME_MAPPINGS = {"PGFLoadTextFile": "PGF - Load Text Files"}
