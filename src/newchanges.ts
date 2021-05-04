export interface IRoster{
    [key: string]:{
        volume:number|null,
        muted:boolean|null,
        signalStrength:number|null,
        play:(videoElement:HTMLVideoElement) => void
    }
}

export const onUserPresenceChange = (cb:(attendeeId:string,present:boolean) => void) => {
    const callback = (presentAttendeeId:string, present:boolean) => {
        console.log(`Attendee ID: ${presentAttendeeId} Present: ${present}`);
        const date = new Date();
        const timestamp:string = date.toLocaleTimeString();
        attendeePresenceSet.add({presentAttendeeId,present,timestamp});
        cb(presentAttendeeId,present);
    };

    meetingSession!.audioVideo.realtimeSubscribeToAttendeeIdPresence(callback);
}