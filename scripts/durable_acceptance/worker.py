"""Test-only Uvicorn bootstrap. Imports the real app and wraps explicit stage gates.

Configuration arrives on stdin. Credentials are supplied later through real API
headers, never process arguments or environment. Nothing in production imports
this file, and no test endpoint is added to the application.
"""
from __future__ import annotations

import asyncio
import importlib
import inspect
import json
import os
import sys
import time
from pathlib import Path


def main():
    config = json.loads(sys.stdin.readline())
    backend = Path(__file__).resolve().parents[2] / 'backend'
    sys.path.insert(0, str(backend))
    os.environ['DATABASE_URL'] = config['database_url']
    os.environ.pop('LLM_API_KEY', None)
    os.environ.pop('IMG_GEN_API_KEY', None)
    os.chdir(backend)
    # Keeping storage outside the checkout also ensures test assets cannot
    # replace production/local workspace images. Patch constants before routes.
    import storage
    storage.UPLOAD_DIR = Path(config['storage']) / 'uploads'
    storage.IMG_CACHE_DIR = Path(config['storage']) / 'img_cache'
    storage.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    for gate in config.get('gates', []):
        parts = gate['target'].split('.')
        for split in range(len(parts) - 1, 0, -1):
            try:
                owner = importlib.import_module('.'.join(parts[:split]))
                break
            except ModuleNotFoundError:
                continue
        else:
            raise ImportError('Test gate target module missing')
        for attribute in parts[split:-1]:
            owner = getattr(owner, attribute)
        function_name = parts[-1]
        original = getattr(owner, function_name)

        def wrap(function, options):
            matched_count = 0

            def matches(args, kwargs):
                nonlocal matched_count
                signature = inspect.signature(function)
                bound = signature.bind_partial(*args, **kwargs)
                filters = options.get('match', {})
                matched = all(bound.arguments.get(key) == value for key, value in filters.items())
                if matched:
                    matched_count += 1
                return matched and matched_count >= options.get('nth', 1)

            def enter():
                entered = Path(options['entered'])
                entered.write_text(json.dumps({'target': options['target'], 'position': options.get('position', 'before')}))
                if options.get('action') == 'raise':
                    raise RuntimeError('acceptance_forced_transaction_rollback')

            async def gated(*args, **kwargs):
                matched = matches(args, kwargs)

                async def pause():
                    enter()
                    release = Path(options['release'])
                    while not release.exists():
                        await asyncio.sleep(0.025)

                if matched and options.get('position', 'before') == 'before':
                    await pause()
                value = await function(*args, **kwargs)
                if matched and options.get('position', 'before') == 'after':
                    await pause()
                return value

            def synchronous(*args, **kwargs):
                matched = matches(args, kwargs)

                def pause():
                    enter()
                    while not Path(options['release']).exists():
                        time.sleep(0.025)

                if matched and options.get('position', 'before') == 'before':
                    pause()
                value = function(*args, **kwargs)
                if matched and options.get('position', 'before') == 'after':
                    pause()
                return value

            return gated if inspect.iscoroutinefunction(function) else synchronous

        setattr(owner, function_name, wrap(original, gate))

    import uvicorn

    from main import app
    # main.py's static mount intentionally owns its own default path; replace
    # its directory on this test entrypoint with the same isolated asset root.
    for route in app.routes:
        if getattr(route, 'path', None) == '/uploads':
            route.app.directory = str(storage.UPLOAD_DIR)
            route.app.all_directories = [str(storage.UPLOAD_DIR)]
    uvicorn.run(app, host='127.0.0.1', port=config['port'], log_level='info', access_log=False, timeout_graceful_shutdown=5)


if __name__ == '__main__':
    main()
