#!/usr/bin/env python3
"""
ZMQ sniffer for report.options messages.
Usage: python3 zmq_sniffer.py [zmq_address]
Default address: tcp://localhost:5556
"""

import sys
import zmq
import json

def main():
    address = sys.argv[1] if len(sys.argv) > 1 else "tcp://localhost:5556"

    ctx = zmq.Context()
    sock = ctx.socket(zmq.SUB)
    sock.connect(address)

    # Subscribe to report.options topics
    sock.setsockopt_string(zmq.SUBSCRIBE, "report.options")

    print(f"Connected to {address}")
    print("Listening for report.options messages...\n")

    while True:
        try:
            msg = sock.recv_multipart()
            topic = msg[0].decode('utf-8') if msg else ""

            print(f"=== TOPIC: {topic} ===")

            if len(msg) > 1:
                try:
                    data = json.loads(msg[1].decode('utf-8'))
                    underlying = data.get('underlying', '?')
                    expiry = data.get('expiry', '?')
                    rows = data.get('rows', [])

                    print(f"Underlying: {underlying}, Expiry: {expiry}, Rows: {len(rows)}")

                    # Show first few rows with Greeks
                    for i, row in enumerate(rows[:3]):
                        strike = row.get('strike', '?')
                        call = row.get('call', {})
                        put = row.get('put', {})

                        call_delta = call.get('delta', '-')
                        put_delta = put.get('delta', '-')

                        print(f"  Strike {strike}: Call delta={call_delta}, Put delta={put_delta}")

                    if len(rows) > 3:
                        print(f"  ... and {len(rows) - 3} more rows")

                except json.JSONDecodeError as e:
                    print(f"  JSON parse error: {e}")
                    print(f"  Raw: {msg[1][:200]}...")

            print()

        except KeyboardInterrupt:
            print("\nStopped.")
            break

if __name__ == "__main__":
    main()
