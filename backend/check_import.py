import sys, traceback, os
sys.path.append(r'b:/Program Files/PayPal Hackathon/bahikhata/invoice-assistant/backend')
try:
    import main
    print('import succeeded')
except Exception as e:
    traceback.print_exc()
