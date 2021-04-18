import unittest
import json
import os
import typing
import abc

from . import task

class Spy(task.Tally):
    def __init__(self):
        super().__init__()
        self.reset()

    def reset(self):
        self.at_start = None
        self.at_yields = []
        self.at_success = None
        self.at_failure = None

    def on_start(self, task: task.Task):
        super().on_start(task)
        self.at_start = task.to_json()

    def on_yield(self, task: task.Task):
        super().on_yield(task)
        self.at_yields.append(task.to_json())

    def on_success(self, task: task.Task):
        super().on_success(task)
        self.at_success = task.to_json()

    def on_failure(self, task: task.Task):
        super().on_failure(task)
        self.at_failure = task.to_json()

__tally__ = Spy()

@task.function(__tally__)
def function1(a, b):
    return a+b

@task.function(__tally__)
def function2(a, b):
    return 0/0

@task.generator(__tally__)
def function3(a, b):
    yield 0
    yield 1
    yield 2

class TestFunction(unittest.TestCase):
    def test_function1_success(self):
        __tally__.reset()
        result = function1(1, 2)
        self.assertEqual(result, 3, f'Expected result of 1+2 to be 3 but got {result}')
        self.assertIsNotNone(__tally__.at_start)
        self.assertEqual(len(__tally__.at_yields), 0, 'function1 should not yield anything, but this one did!')
        self.assertIsNotNone(__tally__.at_success)
        self.assertIsNone(__tally__.at_failure)

    def test_function2_failure(self):
        __tally__.reset()
        try:
            result = function2(1, 2)
        except Exception:
            pass

        print(f"DEBUG: {json.dumps(__tally__.__dict__, default=str)}")
        self.assertIsNotNone(__tally__.at_start)
        self.assertEqual(len(__tally__.at_yields), 0, 'function3 should not yield anything, but this one did!')
        self.assertIsNotNone(__tally__.at_failure)
        self.assertIsNone(__tally__.at_success)

    def test_function3_success(self):
        __tally__.reset()
        result = list(function3(1, 2))
        self.assertIsNotNone(__tally__.at_start)
        self.assertEqual(len(result), 3, 'list(function3) should return 3 items!')
        self.assertEqual(len(__tally__.at_yields), 3, 'function3 should yield 3 items!')
        self.assertIsNotNone(__tally__.at_success)
        self.assertIsNone(__tally__.at_failure)

if __name__ == '__main__':
    unittest.main()
