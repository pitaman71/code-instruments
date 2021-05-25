#!/usr/bin/env python3

from __future__ import annotations
import typing
import enum
import arrow
import abc
import string
import datetime
import random
import functools
import inspect
import json
import traceback

class Status(enum.Enum):
    Unknown = 0
    Run = 1
    Fail = 2
    Succeed = 3

status_to_emoji = {
    Status.Unknown: "🤷",
    Status.Run: "🏃",
    Status.Fail: "👎",
    Status.Succeed: "👍"
}

tally_var_name = '__tally__'

class Scope:
    kind: str
    name: str

    def __init__(self, kind: str, name: str):
        self.kind = kind
        self.name = name

    def __str__(self):
        return self.name

class Monitor:
    @abc.abstractmethod
    def reset(self):
        pass

    @abc.abstractmethod
    def on_start(self, task: Task):
        pass

    @abc.abstractmethod
    def on_yield(self, task: Task):
        pass

    @abc.abstractmethod
    def on_success(self, task: Task):
        pass

    @abc.abstractmethod
    def on_failure(self, task: Task):
        pass

class Tally(Monitor):
    scopes: typing.List[Scope]
    start_time: datetime.datetime
    consumed: typing.Dict[ str, int|float ]
    pending: typing.Set[ Task ]
    listeners: typing.List[ Monitor ]

    def __init__(self, *scopes: Scope):
        self.scopes = list(scopes)
        self.start_time = datetime.datetime.now()
        self.consumed = {}
        self.pending = set()
        self.listeners = []

    def __str__(self):
        return '.'.join([ str(scope) for scope in self.scopes])

    def notifies(self, listener: Monitor):
        self.listeners.append(listener)
        return self

    def reset(self):
        self.consumed = {}
        self.pending = set()
        self.start_time = datetime.datetime.now()
        return self

    def on_start(self, task: Task):
        for listener in self.listeners:
            listener.on_start(task)
        self.pending.add(task)
        return self

    def on_yield(self, task: Task):
        for listener in self.listeners:
            listener.on_yield(task)
        return self

    def on_success(self, task: Task):
        for listener in self.listeners:
            listener.on_success(task)
        self.pending.remove(task)
        for key in task.consumed.keys():
            self.consumed[key] = (self.consumed.get(key) or 0) + task.consumed[key]
        return self

    def on_failure(self, task: Task):
        for listener in self.listeners:
            listener.on_failure(task)
        self.pending.remove(task)
        for key in task.consumed.keys():
            self.consumed[key] = (self.consumed.get(key) or 0) + task.consumed[key]
        return self

    def to_json(self) -> typing.Dict[str, typing.Any]:
        seconds = (datetime.datetime.now() - self.start_time).total_seconds()
        result = {}
        for key in self.consumed.keys():
            tag = '.'.join([ str(scope) for scope in self.scopes ] + [key])
            result[tag] = {
                'count': self.consumed.get(key),
                'perSecond': self.consumed.get(key) / seconds
            }
        return result

class Call:
    def __init__(self, stack_entry, func=None):
        self.func = func
        self.stack_entry = stack_entry
        self.purpose = None
        self.filename = None
        self.lineno = None

    def inspect(self):
        caller = inspect.getframeinfo(self.stack_entry)
        self.filename = caller.filename.split('/')[-1]
        self.lineno = caller.lineno
        self.purpose = '%s.%d: ' % (self.filename,caller.lineno)
        if hasattr(self.func, 'im_class'):
            self.purpose += self.func.im_class.__name__
            self.purpose += '.'
        elif hasattr(self.func, '__qualname__'):
            self.purpose += self.func.__qualname__
        elif hasattr(self.func, '__name__'):
            self.purpose += self.func.__name__

    def get_filename(self):
        if self.filename is None:
            self.inspect()
        return self.filename

    def get_lineno(self):
        if self.lineno is None:
            self.inspect()
        return self.lineno

    def __str__(self):
        if self.purpose is None:
            self.inspect()
        return self.purpose

class Task:
    id_: str
    parent_id: typing.Union[ str, None ]
    purpose: typing.Union[str, None]
    start_time: typing.Union[datetime.datetime, None]
    end_time: typing.Union[datetime.datetime, None]
    status: Status = Status.Unknown
    consumed: typing.Dict[ str, int|float ]
    tags: typing.Set[ str ]
    listeners: typing.List[ Monitor ]

    warnings: typing.List
    errors: typing.List
    args: typing.Union[typing.List[typing.Any], None]
    kwargs: typing.Union[typing.Dict[str, typing.Any], None]
    return_value: typing.Any
    exception: typing.Any

    json_formatter: typing.Union[typing.Callable[ [typing.Any], typing.Any ], None]
    logger: typing.Union[ typing.Callable[ [str], None ], None ]
    log_enable: typing.Union[ typing.Callable[ [], bool ], None ]

    def __init__(self,
        purpose: str=None,
        parent: Task=None
    ):
        self.purpose = purpose
        self.parent_id = None if parent is None else parent.id_
        self.id_ = ''.join(random.choices(string.ascii_uppercase + string.digits, k=7))

        self.start_time = None
        self.end_time = None
        self.status = Status.Unknown
        self.consumed = {}
        self.tags = set()
        self.listeners = []

        self.warnings = []
        self.errors = []
        self.args = None
        self.kwargs = None

        self.return_value = None
        self.exception = None

        self.json_formatter = None
        self.logger = None
        self.log_enable = None

    def to_log_line(self, verb: str, body: str = None) -> str:
        return f"{status_to_emoji[self.status]} {self.id_} {verb}{body or self.purpose}"

    def notifies(self, listener: Monitor):
        self.listeners.append(listener)
        return self

    def on_start(self):
        self.start_time = datetime.datetime.now()
        self.status = Status.Run
        self.consumed['outcome.hasStarted'] = (self.consumed.get('outcome.hasStarted') or 0) + 1
        use_logger = self.logger if (self.log_enable is None or self.log_enable()) else None
        if use_logger is not None:
            use_logger(self.to_log_line('BEGIN '))
            if self.args is not None:
                use_logger(self.to_log_line('ARGS  ', json.dumps(self.args)))
            if self.kwargs is not None:
                use_logger(self.to_log_line('KWARGS ', json.dumps(self.kwargs)))
        for listener in self.listeners:
            listener.on_start(self)
        return self

    def on_yield(self, value):
        use_logger = self.logger if (self.log_enable is None or self.log_enable()) else None
        if use_logger is not None and value is not None:
            use_logger(self.to_log_line('YIELD ', json.dumps(value)))
        for listener in self.listeners:
            listener.on_yield(self)
        return self

    def on_success(self, return_value):
        self.end_time = datetime.datetime.now()
        self.status = Status.Succeed
        self.return_value = return_value
        self.consumed['outcome.hasSucceeded'] = (self.consumed.get('outcome.hasSucceeded') or 0) + 1
        use_logger = self.logger if (self.log_enable is None or self.log_enable()) else None
        if use_logger is not None:
            use_logger(self.to_log_line('END   '))
            if self.return_value is not None:
                use_logger(self.to_log_line('RETURN ', json.dumps(self.return_value)))
        for listener in self.listeners:
            listener.on_success(self)
        return self

    def on_failure(self, exception):
        self.end_time = datetime.datetime.now()
        self.status = Status.Fail
        self.exception = exception
        self.consumed['outcome.hasFailed'] = (self.consumed.get('outcome.hasFailed') or 0) + 1
        use_logger = self.logger if (self.log_enable is None or self.log_enable()) else None
        if use_logger is not None:
            if exception is not None:
                use_logger(self.to_log_line('FAIL  ', str(exception)))
                use_logger(self.to_log_line('TRACE ', traceback.print_tb(self.exception.__traceback__)))
            else:
                use_logger(self.to_log_line('FAIL  '))
        for listener in self.listeners:
            listener.on_failure(self)
        return self

    def format(self, json_formatter: typing.Callable[ [typing.Any], typing.Any]):
        self.json_formatter = json_formatter
        return self

    def with_tags(self, *tags:str):
        self.tags = set(tags)
        return self

    def logs(self, logger: typing.Callable[ [str], None], log_enable: typing.Callable[ [], bool ]):
        self.logger = logger
        self.log_enable = log_enable
        return self

    def returns(self, args, kwargs, callable: typing.Callable[ [], typing.Any]):
        self.args = list(args)
        self.kwargs = kwargs
        try:
            self.on_start()
            returned = callable()
            self.on_success(returned)
            return returned
        except Exception as err:
            self.on_failure(err)            
            raise err

    def generates(self, args, kwargs, callable: typing.Callable[ [], typing.Generator]):
        self.args = list(args)
        self.kwargs = kwargs
        try:
            self.on_start()
            for item in callable():
                self.on_yield(item)
                yield item
            self.on_success(None)
        except Exception as err:
            self.on_failure(err)            
            raise err

    def __enter__(self):
        self.on_start()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if exc_type is not None:
            self.on_failure(exc_value)
        else:
            self.on_success(None)

    def info(self, *messages: str):
        use_logger = self.logger if (self.log_enable is None or self.log_enable()) else None
        if use_logger is not None:
            for message in messages:
                use_logger(self.to_log_line('INFO  ', message))
        return self

    def warning(self, *messages: str):
        use_logger = self.logger if (self.log_enable is None or self.log_enable()) else None
        if use_logger is not None:
            for message in messages:
                use_logger(self.to_log_line('WARN  ', message))
        self.warnings += messages
        return self

    def error(self, *messages: str):
        use_logger = self.logger if (self.log_enable is None or self.log_enable()) else None
        if use_logger is not None:
            for message in messages:
                use_logger(self.to_log_line('ERROR ', message))
        self.errors += messages
        return self

    def has_warnings(self):
        return self.warnings is not None and len(self.warnings) > 0

    def has_errors(self):
        return self.errors is not None and len(self.errors) > 0

    def to_json(self):
        result = {}
        if self.id_ is not None: result['id'] = self.id_
        if self.parent_id is not None: result['parent_id'] = self.parent_id
        if self.purpose is not None: result['purpose'] = self.purpose
        if self.status is not None: result['status'] = self.status
        if self.start_time is not None: result['start_time'] = str(self.start_time)
        if self.end_time is not None: result['end_time'] = str(self.end_time)
        result['warnings'] = self.warnings
        result['errors'] = self.errors
        result['args'] = self.args
        result['kwargs'] = self.kwargs
        if self.return_value is not None: result['return_value'] = self.return_value
        if self.exception is not None: result['exception'] = self.exception
        return result

    def from_json(self, obj):
        self.parent_id = obj.get('parent_id')
        self.id_ = obj.get('id')
        self.purpose = obj.get('purpose')
        self.status = obj.get('status')
        self.start_time = arrow.get(obj.get('start_time')).datetime if 'start_time' in obj else None
        self.end_time = arrow.get(obj.get('end_time')).datetime if 'end_time' in obj else None

        self.warnings = obj.get('warnings')
        self.errors = obj.get('errors')
        self.args = obj.get('args')
        self.kwargs = obj.get('kwargs')
        self.return_value = obj.get('return_value')
        self.exception = obj.get('exception')

    def get_purpose(self, limit=160):
        if self.purpose is None:
            return self.purpose
        purpose = str(self.purpose)
        if len(purpose) > limit - 4:
            purpose = f"{purpose[0:limit-4]} ..."
        return purpose

    def get_returns(self, limit=80):
        if self.return_value is None:
            return self.return_value
        return_value = str(self.return_value)
        if len(return_value) > limit - 4:
            return_value = f"{return_value[0:limit-4]} ..."
        return return_value

def function(parent_: Monitor = None, **deco_kwargs):
    """Decorate a function as a trackable task"""
    def wrap_function(func):
        @functools.wraps(func)
        def call_function_task(*call_args,**call_kwargs):
            purpose = str(Call(inspect.currentframe().f_back, func))
            parent = parent_ or __tally__
            return Task(purpose,**deco_kwargs).notifies(parent).returns(call_args,call_kwargs,
                lambda: func(*call_args,**call_kwargs)
            )
        return call_function_task
    return wrap_function

def generator(parent_: Monitor = None, **deco_kwargs):
    """Decorate a function as a trackable task"""
    def wrap_function(func):
        @functools.wraps(func)
        def call_function_task(*call_args,**call_kwargs):
            purpose = str(Call(inspect.currentframe().f_back, func))
            parent = parent_ or __tally__
            return Task(purpose,**deco_kwargs).notifies(parent).generates(call_args,call_kwargs,
                lambda: func(*call_args,**call_kwargs)
            )
        return call_function_task
    return wrap_function

def method(*deco_args,**deco_kwargs):
    """Decorate a method as a trackable task"""
    def wrap_function(func):
        @functools.wraps(func)
        def call_function_task(self, *call_args,**call_kwargs):
            purpose = str(Call(inspect.currentframe().f_back, func))
            if hasattr(self.__class__, tally_var_name):
                parent = getattr(self.__class__, tally_var_name)
            else:
                parent = globals().get(tally_var_name) or __tally__
            return Task(purpose,*deco_args,**deco_kwargs).notifies(parent).returns(call_args,call_kwargs,
                lambda: func(self, *call_args,**call_kwargs)
            )
        return call_function_task
    return wrap_function

def klass(*deco_args,**deco_kwargs):
    def wrap_class(cls):
        parent = globals().get(tally_var_name) or __tally__
        cls.tally = Tally().notifies(parent)
        return cls
    return wrap_class

scope = Scope('module', 'code_instruments.monitors')
__tally__ = Tally(scope)
