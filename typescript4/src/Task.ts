import { DateTime } from 'luxon';
import stringify from 'json-stringify-safe';

export enum Status {
    Unknown = 0,
    Run = 1,
    Fail = 2,
    Succeed = 3
}

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
    onStart(task: Task): void;
    onYield(task: Task): void;
    onSuccess(task: Task): void;
    onFailure(task: Task): void;
}

export class Tally implements Monitor {
    scopes: Array<Scope>;
    startTime: DateTime;
    consumed: { [key:string]: number};
    pending: Array<Task>;
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

    onStart(task: Task) {
        this.listeners.forEach((listener: Monitor) => listener.onStart(task));
    }

    onYield(task: Task) {
        this.listeners.forEach((listener: Monitor) => listener.onYield(task));
    }

    onSuccess(task: Task) {
        this.listeners.forEach((listener: Monitor) => listener.onSuccess(task));
    }

    onFailure(task: Task) {
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

export interface Reporter {
    info(... messages: Array<string>): void;
    warning(... messages: Array<string>): void;
    error(... messages: Array<string>): void;
};

export class Task implements Reporter {
    id_: string;
    parent_id: string|undefined;
    purpose: string;
    startTime?: DateTime;
    endTime?: DateTime;
    status: Status;
    consumed: { [key:string]: number } = {};
    tags: string[] = [];
    listeners: Array<Monitor> = [];

    warnings: any[];
    errors: any[];
    args: Array<any>;
    kwargs: { [key:string]: any };
    returnValue?: any;
    exception?: any;

    jsonFormatter?: (obj:any) => any;
    logger?: (message: string) => void;
    logEnable?: () => boolean;

    constructor(purpose: string, parent?:Task) {
        this.purpose = purpose;
        this.parent_id = parent ? parent.id_ : undefined;
        this.id_  = makeid(7);

        this.status = Status.Unknown;
        this.consumed = {};
        this.tags = [];
        this.listeners = [];

        this.warnings = [];
        this.errors = [];
        this.args = [];
        this.kwargs = {};
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

    private onStart(args: any): this {
        this.startTime = DateTime.now();
        this.status = Status.Run;
        this.args = this.jsonFormatter ? this.jsonFormatter(args) : args;
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

    private onSuccess(returnValue: any): this {
        this.endTime = DateTime.now();
        this.status = Status.Succeed;
        this.returnValue = this.jsonFormatter ? this.jsonFormatter(returnValue) : returnValue;
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

    format(jsonFormatter: (obj:any) => any) {
        this.jsonFormatter = jsonFormatter;
        return this;
    }

    withTags(...tags:string[]) {
        this.tags = tags;
        return this;
    }

    logs(logger: (message: string) => void, logEnable?: () => boolean): this {
        this.logger = logger;
        this.logEnable = logEnable;
        return this;
    }

    returns<ReturnT>(args: any, callable: (reporter: Reporter) => ReturnT): ReturnT {
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

    promises<ReturnT>(args: any, callable: (reporter: Reporter) => Promise<ReturnT>): Promise<ReturnT> {
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

    info(... messages: Array<string>) {
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            messages.forEach((message: string) => useLogger(this.toLogLine('INFO  ', message)));
        }
        return this;
    }

    warning(... messages: Array<string>) {
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            messages.forEach((message: string) => useLogger(this.toLogLine('WARN  ', message)));
        }
        this.warnings = [ ... this.warnings, ... messages];
        return this;
    }

    error(... messages: Array<string>) {
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            messages.forEach((message: string) => useLogger(this.toLogLine('ERROR ', message)));
        }
        this.errors = [ ... this.errors, ... messages];
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
            warnings: this.warnings,
            errors: this.errors,
            args: this.args,
            kwargs: this.kwargs,
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
        this.warnings = json.warnings;
        this.errors = json.errors;
        this.args = json.args;
        this.kwargs = json.kwargs;
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
        return new Task(purpose, ... deco_args).notifies(__tally__).returns(args, () => original.apply(this, args));
    };
  
    return descriptor;
};

const scope = new Scope('module', 'code_instruments.monitors');
const __tally__ = new Tally(scope);
