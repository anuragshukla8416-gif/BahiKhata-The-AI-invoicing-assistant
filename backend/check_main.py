import importlib, sys, traceback, os
sys.path.append(os.path.dirname(__file__))
try:
    import main
    print('import succeeded')
except Exception as e:
    traceback.print_exc()
