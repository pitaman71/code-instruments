import moment from 'moment';
import cryptoRandomString  from 'crypto-random-string';

const logTags:any = {};
const listeners: ((task: Task) => void)[] = [];

export function addListener(tally: (task: Task) => void) {
    listeners.push(tally);
}

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

export class Monitors {
    tallyAll: Tally;
    tallyByTag: { [tag:string]: Tally } = {};

    constructor() {
        this.tallyAll = new Tally('traffic.all');
        addListener((task: Task) => 
            this.tallyAll.collect(task));            
        addListener((task: Task) => {
            task.tags.forEach((tag:string) => {
                if(!Object.getOwnPropertyNames(this.tallyByTag).includes(tag)) {
                    this.tallyByTag[tag] = new Tally(tag);
                }
                this.tallyByTag[tag].collect(task);
            });
        });
    }

    reset() {
        this.tallyAll.reset();
        Object.getOwnPropertyNames(this.tallyByTag).forEach((tag:string) => this.tallyByTag[tag].reset());
    }
    
    toJSON() {
        return Object.getOwnPropertyNames(this.tallyByTag).reduce((tallies: any, tag: string) => {
            return { ... tallies, [tag]: this.tallyByTag[tag] } }, {
                'all': this.tallyAll.toJSON()
            }
        );
    }
}

export class Tally {
    stem: string;
    startTime;

    constructor(stem: string) {
        this.stem = stem;
        this.startTime = moment();
    }

    consumed: {
        [key: string]: number
    } = {};

    reset() {
        this.consumed = {};
        this.startTime = moment();
    }

    collect(task: Task) {
        this.consumed = Object.getOwnPropertyNames(task.consumed).reduce(
            (consumed: { [key: string]: number }, key) => {
                consumed[key] = (consumed[key] || 0) + task.consumed[key]
                return consumed;
            }, this.consumed
        );
    }

    toJSON() {
        const seconds = moment().diff(this.startTime, 'seconds');
        return Object.getOwnPropertyNames(this.consumed).reduce( (result: any, tag: string) =>
            { return { ... result, ... { [`${this.stem}.${tag}`] : {
                count: this.consumed[tag],
                per_second: this.consumed[tag] / seconds
            } } } }
        , {});
    }
}

export class Task {
    parent?: Task;
    id: string;
    purpose: string;
    startTime?: moment.Moment;
    endTime?: moment.Moment;
    status: Status = Status.Unknown;
    consumed: { [key:string]: number } = {};
    tags: string[] = [];

    warnings: any[];
    errors: any[];
    args: any;
    returnValue?: any;
    exception?: any;

    jsonFormatter?: (obj:any) => any;
    logger?: (message: string) => void;
    logEnable?: () => boolean;

    constructor(purpose: string, parent?:Task) {
        this.purpose = purpose;
        this.parent = parent;
        this.id = cryptoRandomString({length: 7, type: 'alphanumeric'});
        this.warnings = [];
        this.errors = [];
        this.args = [];
    }

    toJSON() {
        return {
            ...this.parent && { parent_id: this.parent.id },
            ...this.id && { id: this.id },
            ...this.purpose && { purpose: this.purpose.toString() },
            ...this.startTime && { startTime: this.startTime.toISOString() },
            ...this.endTime && { endTime: this.endTime.toISOString() },
            warnings: this.warnings,
            errors: this.errors,
            args: this.args,
            ...this.returnValue && { returnValue: this.returnValue },
            ...this.exception && { exception: this.exception },
            ...this.status && { status: this.status }
        }
    }

    toLogLine(verb: string, body?: string):string {
        return `${statusToEmoji[this.status]} ${this.id} ${verb}${body || this.purpose}`;
    }

    private onStart(args: any): this {
        this.startTime = moment();
        this.status = Status.Run;
        this.args = this.jsonFormatter ? this.jsonFormatter(args) : args;
        this.consumed['outcome.hasStarted'] = (this.consumed['outcome.hasStarted'] || 0) + 1;
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            useLogger(this.toLogLine('BEGIN '));
            if(this.args) {
                useLogger(this.toLogLine('ARGS  ', JSON.stringify(this.args)));
            }
        }
        return this;
    }

    private onSuccess(returnValue: any): this {
        this.endTime = moment();
        this.status = Status.Succeed;
        this.returnValue = this.jsonFormatter ? this.jsonFormatter(returnValue) : returnValue;
        this.consumed['outcome.hasSucceeded'] = (this.consumed['outcome.hasSucceeded'] || 0) + 1;
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            useLogger(this.toLogLine('END   '));
            if(this.returnValue) {
                useLogger(this.toLogLine('RETURN ', JSON.stringify(this.returnValue)));
            }
        }
        listeners.forEach((listener) => listener(this));
        return this;
    }
    
    private onFailure(exception: Error): this {
        this.endTime = moment();
        this.status = Status.Fail;
        this.exception = exception;
        this.consumed['outcome.hasFailed'] = (this.consumed['outcome.hasFailed'] || 0) + 1;
        const useLogger = (!this.logEnable || this.logEnable()) ? this.logger : undefined;
        if(useLogger) {
            useLogger(this.toLogLine('FAIL  '));
            if(exception.stack) {
                useLogger(this.toLogLine('STACK ', exception.stack));
            }
        }
        listeners.forEach((listener) => listener(this));
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

    returns<ReturnT>(args: any, callable: () => ReturnT): ReturnT {
        try {
            this.onStart(args);
            const returned = callable();
            this.onSuccess(returned);
            return returned;
        } catch(error) {
            this.onFailure(error);
            throw error;
        }
    }

    promises<ReturnT>(args: any, callable: () => Promise<ReturnT>): Promise<ReturnT> {
        this.onStart(args);
        return callable().then((returned: ReturnT) => {
            this.onSuccess(returned);
            return returned;
        }).catch((error: Error) => {
            this.onFailure(error);
            return Promise.reject(error);
        });
    }
}

