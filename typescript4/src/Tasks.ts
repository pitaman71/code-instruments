import { DateTime } from 'luxon';
import stringify from 'json-stringify-safe';

/** 4-state representation of Task status */
export enum Status {
    Unknown = 0,
    Run = 1,
    Fail = 2,
    Succeed = 3
}

/** Improve log readability by using emojis to represent status */
const statusToEmoji = {
    [Status.Unknown]: "🤷",
    [Status.Run]: "🏃",
    [Status.Fail]: "👎",
    [Status.Succeed]: "👍"
};

const tally_var_name = '__tally__';

export class Scope {
    kind?: string;
    name?: string;

    constructor(kind?: string, name?: string) {
        this.kind = kind;
        this.name = name;
    }

    toString() {
        return this.name;
    }
}

export interface Monitor {
    reset(): void;
    onStart(task: Instrument): void;
    onYield(task: Instrument): void;
    onSuccess(task: Instrument): void;
    onFailure(task: Instrument): void;
}

export class Tally implements Monitor {
    scopes: Array<Scope>;
    startTime: DateTime;
    consumed: { [key:string]: number};
    pending: Array<Instrument>;
    listeners: Array<Monitor>;

    constructor(... scopes: Array<Scope>) {
        this.scopes = scopes;
        this.startTime = DateTime.now();
        this.consumed = {};
        this.pending = [];
        this.listeners = [];
    }

    toString() {
        return this.scopes.map((scope: Scope) => scope.toString()).join('.');
    }

    notifies(listener: Monitor) {
        this.listeners.push(listener);
    }

    reset() {
        this.consumed = {};
        this.pending = [];
        this.startTime = DateTime.now();
        return this;
    }

    onStart(task: Instrument) {
        this.listeners.forEach((listener: Monitor) => listener.onStart(task));
    }

    onYield(task: Instrument) {
        this.listeners.forEach((listener: Monitor) => listener.onYield(task));
    }

    onSuccess(task: Instrument) {
        this.listeners.forEach((listener: Monitor) => listener.onSuccess(task));
    }

    onFailure(task: Instrument) {
        this.listeners.forEach((listener: Monitor) => listener.onFailure(task));
    }

    toJSON() {
        const seconds = DateTime.now().diff(this.startTime, 'seconds').as('seconds');
        return Object.getOwnPropertyNames(this.consumed).reduce( (result: any, key: string) => { 
            const prefix = this.scopes.map((scope:Scope) => scope.toString());
            const tag = [ ... prefix, key ].join('.');
            return { ... result, ... { [tag] : {
                count: this.consumed[key],
                perSecond: this.consumed[key] / seconds
            } } } 
        }, {});
    }
}

// https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript

function makeid(length: number) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * 
 charactersLength));
   }
   return result;
}

/** 
 * Callback interface so that instrumented code can add extra
 * messages to the log as the task executes.
 */
export interface Reporter {
    info(... messages: Array<string>): void;
    warning(... messages: Array<string>): void;
    error(... messages: Array<string>): void;
};

/** 
 * Programmers should instantiate this class to instrument an invokeable tyepscript statement scope.
 */
export class Instrument<PayloadType=any> implements Reporter {
    /** unique invocation identifer, usually 5-6 alphanumeric digits */
    id_: string;

    /** invocation identifier for the parent of a nested task */
    parent_id: string|undefined;

    /** programmer-defined array of strings which are used to categorize and group related tasks */
    tags: string[] = [];

    /** short description of the purpose of this task, what it is doing */
    purpose: string;

    /** when the task started */
    startTime?: DateTime;

    /** when the task returned synchronously or resolved its async promise */
    endTime?: DateTime;

    /** current execution status of this Task */
    status: Status;

    /** programmer-defined map of metric names to units consumed */
    consumed: { [key:string]: number } = {};

    /** array of user-defined registered Monitor objects which receive callbacks when methdos are called on this Task instrument */
    listeners: Array<Monitor> = [];

    /** arguments that were provided by the caller when the instrumented code was invoked */
    args: Array<any>;

    /** value that was synchronously returned by the function or value of the resolved promise for async */
    returnValue?: any;

    /** the exception (or promise rejection) that caused execution of the instrumented code to halt execution */
    exception?: any;

    payloadFormatter?: (payload: PayloadType) => any;
    logger?: (message: string) => void;
    logEnable?: () => boolean;

    constructor(
        /** short description of the purpose of this task, what it is doing */
        purpose: string, 
        /** parent task, if this is a nested task */
        parent?:Instrument
    ) {
        this.purpose = purpose;
        this.parent_id = parent ? parent.id_ : undefined;
        this.id_  = makeid(7);

        this.status = Status.Unknown;
        this.consumed = {};
        this.tags = [];
        this.listeners = [];

        this.args = [];
    }

    toLogLine(verb: string, body?: string):string {
        return `${statusToEmoji[this.status]} ${this.id_} ${verb}${body || this.purpose}`;
    }

    notifies(listener: Monitor) {
        if(!this.listeners.includes(listener)) {
            this.listeners.push(listener);
        }
        return this;
    }

    private onStart(args: PayloadType): this {
        this.startTime = DateTime.now();
        this.status = Status.Run;
        this.args = this.payloadFormatter ? this.payloadFormatter(args) : args;
        this.consumed['outcome.hasStarted'] = (this.consumed['outcome.hasStarted'] || 0) + 1;
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            useLogger(this.toLogLine('BEGIN '));
            if(this.args) {
                useLogger(this.toLogLine('ARGS  ', stringify(this.args)));
            }
        }
        this.listeners.forEach((listener: Monitor) => listener.onStart(this))
        return this;
    }

    private onYield(value: any): this {
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger && value) {
            useLogger(this.toLogLine('YIELD ', stringify(value)));
        }
        this.listeners.forEach((listener: Monitor) => listener.onYield(this))
        return this;
    }

    private onSuccess(returnValue: PayloadType): this {
        this.endTime = DateTime.now();
        this.status = Status.Succeed;
        this.returnValue = this.payloadFormatter ? this.payloadFormatter(returnValue) : returnValue;
        this.consumed['outcome.hasSucceeded'] = (this.consumed['outcome.hasSucceeded'] || 0) + 1;
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            useLogger(this.toLogLine('END   '));
            if(this.returnValue) {
                useLogger(this.toLogLine('RETURN ', stringify(this.returnValue)));
            }
        }
        this.listeners.forEach((listener: Monitor) => listener.onSuccess(this))
        return this;
    }
    
    private onFailure(exception: Error): this {
        this.endTime = DateTime.now();
        this.status = Status.Fail;
        this.exception = exception;
        this.consumed['outcome.hasFailed'] = (this.consumed['outcome.hasFailed'] || 0) + 1;
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            useLogger(this.toLogLine('FAIL  '));
            useLogger(this.toLogLine(`ERROR ${exception}`));
            if(exception.stack) {
                useLogger(this.toLogLine('STACK ', exception.stack));
            }
        }
        this.listeners.forEach((listener: Monitor) => listener.onFailure(this))
        return this;
    }

    format(payloadFormatter: (payload: PayloadType) => any) {
        this.payloadFormatter = payloadFormatter;
        return this;
    }

    /** Caller should use this method during task setup to associate a user-defined set of string-valued tags with this task */
    withTags(...tags:string[]) {
        this.tags = tags;
        return this;
    }

    /** Caller should use this method during task setup to configure output logging */
    logs(logger: (message: string) => void, logEnable?: () => boolean): this {
        this.logger = logger;
        this.logEnable = logEnable;
        return this;
    }

    /** Caller should use this method to wrap the body of a synchronous function or method */
    returns<ReturnT extends PayloadType>(args: any, callable: (reporter: Reporter) => ReturnT): ReturnT {
        try {
            this.onStart(args);
            const returned = callable(this);
            this.onSuccess(returned);
            return returned;
        } catch(error: any) {
            this.onFailure(error);
            throw error;
        }
    }

    /** Caller should use this method to wrap the body of an async function or method */
    promises<ReturnT extends PayloadType>(args: any, callable: (reporter: Reporter) => Promise<ReturnT>): Promise<ReturnT> {
        this.onStart(args);
        try {
            return callable(this).then((returned: ReturnT) => {
                this.onSuccess(returned);
                return returned;
            }).catch((error) => {
                this.onFailure(error);
                return Promise.reject(error);
            });
        } catch(error: any) {
            this.onFailure(error);
            return Promise.reject(error);
        }
    }

    /** Instrumented code may invoke this method to log information associated with this task */
    info(... messages: Array<string>) {
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            messages.forEach((message: string) => useLogger(this.toLogLine('INFO  ', message)));
        }
        return this;
    }

    /** Instrumented code may invoke this method to log warnings associated with this task */
    warning(... messages: Array<string>) {
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            messages.forEach((message: string) => useLogger(this.toLogLine('WARN  ', message)));
        }
        return this;
    }

    /** Instrumented code may invoke this method to log errors associated with this task */
    error(... messages: Array<string>) {
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            messages.forEach((message: string) => useLogger(this.toLogLine('ERROR ', message)));
        }
        return this;
    }

    toJSON() {
        return {
            ...this.id_ && { id: this.id_ },
            ...this.parent_id && { parent_id: this.parent_id },
            ...this.purpose && { purpose: this.purpose.toString() },
            ...this.status && { status: this.status },
            ...this.startTime && { startTime: this.startTime.toString() },
            ...this.endTime && { endTime: this.endTime.toString() },
            args: this.args,
            ...this.returnValue && { returnValue: this.returnValue },
            ...this.exception && { exception: this.exception }
        }
    }

    fromJSON(json: any) {
        this.id_ = json.id;
        this.parent_id = json.parent_id;
        this.purpose = json.purpose;
        this.status = json.status;
        this.startTime = DateTime.fromISO(json.startTime);
        this.endTime = DateTime.fromISO(json.endTime);
        this.args = json.args;
        this.returnValue = json.returnValue;
        this.exception = json.exception;
    }
}

export const method = (...deco_args: any[]) => (
    target: Object,
    propertyKey: string,
    descriptor: PropertyDescriptor
) => {
    const original = descriptor.value;
  
    descriptor.value = function (...args: any[]) {
        const purpose = `${original.name}(${args.map((arg:any) => arg.toString()).join(", ")})`;
        return new Instrument(purpose, ... deco_args).notifies(__tally__).returns(args, () => original.apply(this, args));
    };
  
    return descriptor;
};

const scope = new Scope('module', 'code_instruments.monitors');
const __tally__ = new Tally(scope);
