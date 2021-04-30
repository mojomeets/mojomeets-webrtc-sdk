export interface IRoster{
    [key: string]:{
        attendeeId:string,
        volume:number|null,
        muted:boolean|null,
        signalStrength:number|null
    }
}