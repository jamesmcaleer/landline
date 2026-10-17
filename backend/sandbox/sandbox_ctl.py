"""Create, stop and inspect Chalk sandboxes for Landline. Run with sandbox/.venv/bin/python.

  sandbox_ctl.py start <connectionId> <wsUrl> <token>   prints {"sandboxId":..., "name":...}
  sandbox_ctl.py stop <name>
  sandbox_ctl.py status <name>
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sandbox_name(connection_id: str) -> str:
    return "lndl-" + connection_id.lower().replace("_", "-")


def start(connection_id: str, ws_url: str, token: str) -> None:
    from chalkcompute import ComputeClass, Image, RestartPolicy, Sandbox

    image = (
        Image.debian_slim("3.12")
        .apt_install(["chromium", "fonts-liberation", "curl", "ca-certificates"])
        .pip_install(["websockets"])
        .add_local_file(str(HERE / "entrypoint.sh"), "/app/entrypoint.sh", mode=0o755, strategy="copy")
        .add_local_file(str(HERE / "relay.py"), "/app/relay.py", strategy="copy")
    )
    name = sandbox_name(connection_id)
    sandbox = Sandbox(
        image=image,
        name=name,
        entrypoint=["/app/entrypoint.sh"],
        env={"LANDLINE_WS_URL": ws_url, "LANDLINE_TOKEN": token},
        cpu="1",
        memory="2Gi",
        compute_class=ComputeClass.HOST,
        restart_policy=RestartPolicy.ALWAYS,
    )
    sandbox.run(wait=True)
    print(json.dumps({"sandboxId": sandbox.id, "name": name}))


def stop(name: str) -> None:
    from chalkcompute import Sandbox

    Sandbox.from_name(name).terminate()


def status(name: str) -> None:
    from chalkcompute import Sandbox

    print(Sandbox.from_name(name).refresh().status)


def main() -> int:
    args = sys.argv[1:]
    try:
        if len(args) == 4 and args[0] == "start":
            start(args[1], args[2], args[3])
        elif len(args) == 2 and args[0] == "stop":
            stop(args[1])
        elif len(args) == 2 and args[0] == "status":
            status(args[1])
        else:
            print(__doc__, file=sys.stderr)
            return 2
    except Exception as err:  # noqa: BLE001
        print(f"{type(err).__name__}: {err}", file=sys.stderr)
        return 1
    return 0


sys.exit(main())
