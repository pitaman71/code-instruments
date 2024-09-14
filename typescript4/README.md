# Typescript Code Instruments

Task logging library for typescript.

This module contains utilities for instrumenting typescript code in anticipation of measurement 
and debug activities around performance optimization and functionality issues.

Instruments are extra lines of code that we add to a program in order to support fine-grained
measurement of performance and functional debug tracing.

[Documentation]()

# Proactive + Predictable + Durable Instrumentation

In a typical coding methodology, code instruments are added at the last minute, driven by a 
(sometimes very urgent) need to debug a particular problem or optimize a particular code execution
pathway. The bespoke nature of these on-demand code instruments leads to a variety of log message
syntaxes, each of which needs its own analytics script. Moreover, the instrumentation code is
treated as disposable, often being removed during the PR review process.

An alternative coding instrumentation methodology is to add the instruments up-front, at low cost, 
to any execution scope that might have nontrivial performance or functionality impact systematically 
as a matter of coding practice. 

These utilities are designed to support a coding methodology where code instruments are be added
proactively, before the moment when they are (perhaps very urgently) needed. The code instruments
can convey a variety of data structures inside of a log format that is predictable and consistent.
It is this consistency that enables the coding team to develop of a durable kit of log-based analytics 
scripts that make use of this consistent log format. 

Of course, in order for these code instruments to be durable throughout the code development
lifecycle, even in production, these utilities also mustminimize any negative impact on readability 
or performance of the instrumented code.

# Features

Each code instrument can be individually activated or deactivated. All code instruments are disabled by default.
Python3 bindings are deprecated.

Whenever an instrument notices that the statement scope has been invoked, a 5-character human readable 
invocation ID is automatically generated. This invocation ID is printed with every log message.

## Task

The primary code instrument is a `Task`. The `Task` module allows programmers to attach this kind of code instrument 
to a typescript statement scope such as a method, a function, or a statement block. The instrumented code may
be synchronous or async code.

For example, consider this non-instrumented code:

```
    Promise.all([ 
        ...zone.streams().properties().map(stream => {
            stream.scalar?.pull ? stream.scalar.pull() :
            stream.set?.pull ? stream.set.pull() :
            stream.sequence?.pull ? stream.sequence.pull() :
            stream.map?.pull ? stream.map.pull() : Promise.resolve()
        }),
        ...zone.streams().relations().map(stream => {
            stream.pull ? stream.pull() : Promise.resolve();
        })
    ])
```

After adding a code instrument, this code looks like this:

```
    return new Task.Task(`update proposal`).logs(console.log).promises({ peerId }, () => (
        Promise.all([ 
            ...zone.streams().properties().map(stream => {
                stream.scalar?.pull ? stream.scalar.pull() :
                stream.set?.pull ? stream.set.pull() :
                stream.sequence?.pull ? stream.sequence.pull() :
                stream.map?.pull ? stream.map.pull() : Promise.resolve()
            }),
            ...zone.streams().relations().map(stream => {
                stream.pull ? stream.pull() : Promise.resolve();
            })
        ])
    ))
```
