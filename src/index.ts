import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  MeetingSessionStatus,
  DefaultModality,
  DefaultActiveSpeakerPolicy,
  VideoTileState,
  VideoSource,
  MeetingSessionVideoAvailability,
  MeetingSessionStatusCode,
  DefaultVideoTile
} from "amazon-chime-sdk-js";

import { IMeeting } from "./interfaces/IMeeting";
import { IIndexMap } from "./interfaces/IIndexMap";
import { IRoster } from "./interfaces/IRoster";

export let meetingSession: DefaultMeetingSession;

export const attendeePresenceSet = new Set();

export const roster: IRoster = {};

let localTileId: number | null;

//////////////////////////////////////////////////// Creating a Meeting //////////////////////////////////////////////////////////

// Creates a meeting using meetingResponse & attendeeResponse from backend
export const createMeeting = async (meeting: IMeeting) => {

  const logger: ConsoleLogger = new ConsoleLogger("MyLogger", LogLevel.INFO);
  const deviceController: DefaultDeviceController = new DefaultDeviceController(logger);

  // You need responses from server-side Chime API. See below for details.
  const meetingResponse = JSON.parse(meeting.meetingResponse);
  const attendeeResponse = JSON.parse(meeting.attendeeResponse);

  const configuration: MeetingSessionConfiguration = new MeetingSessionConfiguration(meetingResponse, attendeeResponse);

  // In the usage examples below, you will use this meetingSession object.
  meetingSession = new DefaultMeetingSession(
    configuration,
    logger,
    deviceController
  );

  await deviceSelector();
  await startSession(meeting.audioElement);
};

/////////////////////////////////////////////////// Device Selection //////////////////////////////////////////////////////////////

// This function selects the device for audioInput, audioOutput & videoInput
export const deviceSelector = async (): Promise<void> => {

  let audioInputDevices: MediaDeviceInfo[];
  let audioOutputDevices: MediaDeviceInfo[];
  let videoInputDevices: MediaDeviceInfo[];

  let audioInputDeviceInfo: MediaDeviceInfo;
  let audioOutputDeviceInfo: MediaDeviceInfo;
  let videoInputDeviceInfo: MediaDeviceInfo;

  audioInputDevices = await meetingSession.audioVideo.listAudioInputDevices();
  audioOutputDevices = await meetingSession.audioVideo.listAudioOutputDevices();
  videoInputDevices = await meetingSession.audioVideo.listVideoInputDevices();

  // An array of MediaDeviceInfo objects
  audioInputDevices.forEach(mediaDeviceInfo => {
    console.log(`Device ID: ${mediaDeviceInfo.deviceId} Microphone: ${mediaDeviceInfo.label}`);
  });

  // Choose audio input and audio output devices by passing the deviceId of a MediaDeviceInfo object.
  audioInputDeviceInfo = audioInputDevices[0];
  await meetingSession.audioVideo.chooseAudioInputDevice(audioInputDeviceInfo.deviceId);

  audioOutputDeviceInfo = audioOutputDevices[0];
  await meetingSession.audioVideo.chooseAudioOutputDevice(audioOutputDeviceInfo.deviceId);

  videoInputDeviceInfo = videoInputDevices[0];
  await meetingSession.audioVideo.chooseVideoInputDevice(videoInputDeviceInfo.deviceId);

  // You can pass null to choose none. If the previously chosen camera has an LED light on, it will turn off indicating the camera is no longer capturing.
  // await meetingSession.audioVideo.chooseVideoInputDevice(null);

  const observer = {
    audioInputsChanged: async (freshAudioInputDeviceList: MediaDeviceInfo[]): Promise<void> => {

      // An array of MediaDeviceInfo objects
      freshAudioInputDeviceList.forEach(mediaDeviceInfo => {
        console.log(`Device ID: ${mediaDeviceInfo.deviceId} Microphone: ${mediaDeviceInfo.label}`);
      });

      audioInputDeviceInfo = freshAudioInputDeviceList[0];
      await meetingSession.audioVideo.chooseAudioInputDevice(audioInputDeviceInfo.deviceId);

    },
    audioOutputsChanged: async (freshAudioOutputDeviceList: MediaDeviceInfo[]): Promise<void> => {

      console.log("Audio outputs updated: ", freshAudioOutputDeviceList);
      audioOutputDeviceInfo = freshAudioOutputDeviceList[0];
      await meetingSession.audioVideo.chooseAudioOutputDevice(audioOutputDeviceInfo.deviceId);

    },
    videoInputsChanged: async (freshVideoInputDeviceList: MediaDeviceInfo[]): Promise<void> => {

      console.log("Video inputs updated: ", freshVideoInputDeviceList);
      videoInputDeviceInfo = freshVideoInputDeviceList[0];
      await meetingSession.audioVideo.chooseVideoInputDevice(videoInputDeviceInfo.deviceId);

    }
  };

  meetingSession.audioVideo.addDeviceChangeObserver(observer);
};

////////////////////////////////////////////////////////// Statring a session ///////////////////////////////////////////////////////

// This function starts a session, binds an audio element & shows the lifecycle 
const startSession = async (audioElement: string,cbForStart?:() => void, cbForStop?:(sessionStatus: MeetingSessionStatus) => void, cbForConnecting?:(reconnecting: boolean) => void) => {

  const audioTag = document.getElementById(audioElement) as HTMLAudioElement;
  await meetingSession.audioVideo.bindAudioElement(audioTag);

  meetingSession.audioVideo.start();

  const lifecycleObserver = {
    audioVideoDidStart: () => {
      console.log("Started");
      cbForStart!();
    },
    audioVideoDidStop: (sessionStatus: MeetingSessionStatus) => {
      // See the "Stopping a session" section for details.
      console.log("Stopped with a session status code: ", sessionStatus.statusCode());
      cbForStop!(sessionStatus);
    },
    audioVideoDidStartConnecting: (reconnecting: boolean) => {
      if (reconnecting) {
        // e.g. the WiFi connection is dropped.
        console.log("Attempting to reconnect");
        cbForConnecting!(reconnecting);
      }
    }
  };

  meetingSession.audioVideo.addObserver(lifecycleObserver);

  creatingRoster();
};

//////////////////////////////////////////////////////////// Audio //////////////////////////////////////////////////////////////////////

// This function toggles the local user's audio
export const toggleAudio = () => {
  const muted: boolean = meetingSession.audioVideo.realtimeIsLocalAudioMuted();
  if (muted) {
    console.log("Toggle from mute -> unmute");
    meetingSession.audioVideo.realtimeUnmuteLocalAudio();
  } else {
    console.log("Toggle from unmute -> mute");
    meetingSession.audioVideo.realtimeMuteLocalAudio();
  }
};

// This function disables the unmute option for other attendees(Used in presentation mode)
export const disableUnmute = () => {
  meetingSession.audioVideo.realtimeSetCanUnmuteLocalAudio(false);

  // Optional: Force mute.
  meetingSession.audioVideo.realtimeMuteLocalAudio();

  const unmuted = meetingSession.audioVideo.realtimeUnmuteLocalAudio();
  console.log(`${unmuted} is false. You cannot unmute yourself`);
};

// Shows the volume changes made by local user
export const volumeChanges = () => {

  const presentAttendeeId: string = meetingSession.configuration.credentials!.attendeeId!;

  meetingSession.audioVideo.realtimeSubscribeToVolumeIndicator(
    presentAttendeeId,
    (attendeeId, volume, muted, signalStrength) => {
      const baseAttendeeId = new DefaultModality(attendeeId).base();
      if (baseAttendeeId !== attendeeId) {
        // See the "Screen and content share" section for details.
        console.log(`The volume of ${baseAttendeeId}'s content changes`);
      }

      // A null value for any field means that it has not changed.
      console.log(`${attendeeId}'s volume data: `, {
        volume, // a fraction between 0 and 1
        muted, // a boolean
        signalStrength // 0 (no signal), 0.5 (weak), 1 (strong)
      });
    }
  );
};

// Shows that  the local user is muted or unmuted.
export const subscribeMute = () => {

  const presentAttendeeId: string = meetingSession.configuration.credentials!.attendeeId!;

  // To track mute changes
  meetingSession.audioVideo.realtimeSubscribeToVolumeIndicator(
    presentAttendeeId,
    (attendeeId, volume, muted, signalStrength) => {
      // A null value for volume, muted and signalStrength field means that it has not changed.
      if (muted === null) {
        // muted state has not changed, ignore volume and signalStrength changes
        return;
      }

      // mute state changed
      console.log(`${attendeeId}'s mute state changed: `, {
        muted // a boolean
      });
    }
  );
};

// This function return the most active speaker
export const mostActiveSpeaker = (callback: (attendeeId: string[]) => void) => {
  const activeSpeakerCallback = (attendeeIds: string[]) => {
    if (attendeeIds.length) {
      console.log(`${attendeeIds[0]} is the most active speaker`);
      callback(attendeeIds);
    }
  };

  meetingSession.audioVideo.subscribeToActiveSpeakerDetector(
    new DefaultActiveSpeakerPolicy(),
    activeSpeakerCallback
  );
};

/////////////////////////////////////////////////////////// Video /////////////////////////////////////////////////////////////////////

// This function toggles the local user's video
export const toggleVideo = (videoElement: HTMLVideoElement, state: boolean) => {

  if (state) {
    meetingSession.audioVideo.startLocalVideoTile();
  } else {
    meetingSession.audioVideo.stopLocalVideoTile();

    // Optional: You can remove the local tile from the session.
    meetingSession.audioVideo.removeLocalVideoTile();
  }
};

// This function is used to only view 1 single remote user's video(1-1 video call)  
// export const viewOneAttendee = (videoElement: HTMLVideoElement) => {
//   const observer = {
//     // videoTileDidUpdate is called whenever a new tile is created or tileState changes.
//     videoTileDidUpdate: (tileState: VideoTileState) => {
//       // Ignore a tile without attendee ID, a local tile (your video), and a content share.
//       if (!tileState.boundAttendeeId || tileState.localTile || tileState.isContent) {
//         return;
//       }
//       meetingSession.audioVideo.bindVideoElement(tileState.tileId!, videoElement);
//     }
//   };

//   meetingSession.audioVideo.addObserver(observer);
// };

const onVideoPlay = (videoElement:HTMLVideoElement) => {
    const observer = {
        // videoTileDidUpdate is called whenever a new tile is created or tileState changes.
        videoTileDidUpdate: (tileState: VideoTileState) => {
          // Ignore a tile without attendee ID, a local tile (your video), and a content share.
          if (!tileState.boundAttendeeId || tileState.localTile || tileState.isContent) {
            return;
          }
          meetingSession.audioVideo.bindVideoElement(tileState.tileId!, videoElement);
        }
    };
    
    meetingSession.audioVideo.addObserver(observer);
} 

export const attachVideo = (attendeeId:string , videoElement:HTMLVideoElement) => {
    if (roster.hasOwnProperty(attendeeId)){
        roster[attendeeId].play(videoElement);
    }
}

/////////////////////////////////////////////////////////// Screen Share /////////////////////////////////////////////////////////

// This function will share the screen of local user
export const screenShare = async (status: boolean,videoElement:HTMLVideoElement): Promise<void> => {

  if (status) {
    // A browser will prompt the user to choose the screen.
    const contentShareStream = await meetingSession.audioVideo.startContentShareFromScreenCapture();

    await DefaultVideoTile.connectVideoStreamToVideoElement(contentShareStream, videoElement, false);
  } else {
    await meetingSession.audioVideo.stopContentShare();
  }

};

////////////////////////////////////////////////// Attendees ///////////////////////////////////////////////////////////////////////

// Logic -> we have to trigger this functions whenever the new attendee joins the meeting

export const onUserPresenceChange = (cb:(attendeeId:string,present:boolean) => void) => {
    const callback = (presentAttendeeId:string, present:boolean) => {
        console.log(`Attendee ID: ${presentAttendeeId} Present: ${present}`);
        const date = new Date();
        const timestamp:string = date.toLocaleTimeString();
        attendeePresenceSet.add({presentAttendeeId,present,timestamp});
        cb(presentAttendeeId,present);
    };

  meetingSession!.audioVideo.realtimeSubscribeToAttendeeIdPresence(callback);
};

// ***** This function creates a roster(side-navbar) in which we can see the attendee,volume,mute & signalStrength
export const creatingRoster = () => {

  meetingSession.audioVideo.realtimeSubscribeToAttendeeIdPresence(
    (presentAttendeeId: string, present: boolean) => {
      if (!present) {
        delete roster[presentAttendeeId];
        return;
      }

      meetingSession.audioVideo.realtimeSubscribeToVolumeIndicator(
        presentAttendeeId,
        (attendeeId, volume, muted, signalStrength) => {
          const baseAttendeeId = new DefaultModality(attendeeId).base();
          if (baseAttendeeId !== attendeeId) {
            // Optional: Do not include the content attendee (attendee-id#content) in the roster.
            return;
          }

          if (roster.hasOwnProperty(attendeeId)) {
            // A null value for any field means that it has not changed.
            roster[attendeeId].volume = volume; // a fraction between 0 and 1
            roster[attendeeId].muted = muted; // A booolean
            roster[attendeeId].signalStrength = signalStrength; // 0 (no signal), 0.5 (weak), 1 (strong)
          } else {
            // Add an attendee.
            // Optional: You can fetch more data, such as attendee name, from your server application and set them here.
            roster[attendeeId] = {
              volume,
              muted,
              signalStrength,
              play:onVideoPlay
            };
          }
        }
      );
    }
  );
};

/////////////////////////////////////////////////////// Stopping a session ////////////////////////////////////////////////////////////

// This function is supposed to stop the session
export const leaveSession = (cbVideoDidStop:(sessionStatus: MeetingSessionStatus) => void) => {
  const observer = {
    audioVideoDidStop: (sessionStatus: MeetingSessionStatus) => {
        cbVideoDidStop!(sessionStatus);
        const sessionStatusCode = sessionStatus.statusCode();
        if (sessionStatusCode === MeetingSessionStatusCode.Left) {
            /*
                - You called meetingSession.audioVideo.stop().
                - When closing a browser window or page, Chime SDK attempts to leave the session.
            */
            console.log("You left the session");
        } else if (sessionStatusCode === MeetingSessionStatusCode.MeetingEnded) {
            /*
            - You (or someone else) have called the DeleteMeeting API action in your server application.
            - You attempted to join a deleted meeting.
            - No audio connections are present in the meeting for more than five minutes.
            - Fewer than two audio connections are present in the meeting for more than 30 minutes.
            - Screen share viewer connections are inactive for more than 30 minutes.
            - The meeting time exceeds 24 hours.
            See https://docs.aws.amazon.com/chime/latest/dg/mtgs-sdk-mtgs.html for details.
            */
            console.log("The session has ended");
        } else {
            console.log("Stopped with a session status code: ", sessionStatusCode);
        }
    }
  };

  meetingSession.audioVideo.addObserver(observer);

  meetingSession.audioVideo.stop();
};

////////////////////////////////////////////////////////////// AllObservers ///////////////////////////////////////////////////////////////

export const attachAlertObservers = (
    cbForPoorCOnnection?:() => void,
    cbForStopVideo?:() => void,
    cbForVideoUnavailable?:() => void,
    cbForVideoAvailability?:(videoAvailability: MeetingSessionVideoAvailability) => void,
    ) => {
    // Observer to reveive alerts
    const observer = {
        connectionDidBecomePoor: () => {
            console.log("Your connection is poor");
            cbForPoorCOnnection!();
        },
        connectionDidSuggestStopVideo: () => {
            console.log("Recommend turning off your video");
            cbForStopVideo!();
        },
        videoSendDidBecomeUnavailable: () => {
            // Chime SDK allows a total of 16 simultaneous videos per meeting.
            // If you try to share more video, this method will be called.
            // See videoAvailabilityDidChange below to find out when it becomes available.
            console.log("You cannot share your video");
            cbForVideoUnavailable!();
        },
        videoAvailabilityDidChange: (videoAvailability: MeetingSessionVideoAvailability) => {
            // canStartLocalVideo will also be true if you are already sharing your video.
            cbForVideoAvailability!(videoAvailability);
            if (videoAvailability.canStartLocalVideo) {
                console.log("You can share your video");
            } else {
                console.log("You cannot share your video");
            }
        }
    };

    meetingSession.audioVideo.addObserver(observer);
}

export const addVideoObservers = (
    videoElement: HTMLVideoElement,
    cbForVideoDidUpdate?:(tileState: VideoTileState) => void,
    cbForVideoWasRemoved?:(tileId: number) => void) => {
    const videoObserver = {
        videoTileDidUpdate: (tileState: VideoTileState) => {

            cbForVideoDidUpdate!(tileState);
            // Ignore a tile without attendee ID and other attendee's tile.
            if (!tileState.boundAttendeeId || !tileState.localTile) {
                return;
            }
        
            // videoTileDidUpdate is invoked when you call startLocalVideoTile or tileState changes.
            // The tileState.active can be false in poor Internet connection, when the user paused the video tile, or when the video tile first arrived.
            console.log(`If you called stopLocalVideoTile, ${tileState.active} is false.`);
            meetingSession.audioVideo.bindVideoElement(tileState.tileId!, videoElement);
            localTileId = tileState.tileId!;
        },
        videoTileWasRemoved: (tileId: number) => {
            cbForVideoWasRemoved!(tileId);
            if (localTileId === tileId) {
                console.log(`You called removeLocalVideoTile. videoElement can be bound to another tile.`);
                localTileId = null;
            }
        }
      };

    meetingSession.audioVideo.addObserver(videoObserver);
}

export const addScreenShareObservers = (
    cbForVideoDidUpdate?:(tileState: VideoTileState) => void,
    cbForStartShare?:() => void,
    cbForStopShare?:() => void
    ) => {
    const screenShareObserver = {
        videoTileDidUpdate: (tileState: VideoTileState) => {
          // Ignore a tile without attendee ID and videos.


          if (!tileState.boundAttendeeId || !tileState.isContent) {
            return;
          }
    
          cbForVideoDidUpdate!(tileState);
          const yourAttendeeId = meetingSession.configuration.credentials!.attendeeId;
    
          // tileState.boundAttendeeId is formatted as "attendee-id#content".
          const boundAttendeeId = tileState.boundAttendeeId;
    
          // Get the attendee ID from "attendee-id#content".
          const baseAttendeeId = new DefaultModality(boundAttendeeId).base();
          if (baseAttendeeId === yourAttendeeId) {
            console.log("You called startContentShareFromScreenCapture");
          }
        },
        contentShareDidStart: () => {
          console.log("Screen share started");
          cbForStartShare!();
        },
        contentShareDidStop: () => {
            cbForStopShare!();
            // Chime SDK allows 2 simultaneous content shares per meeting.
            // This method will be invoked if two attendees are already sharing content
            // when you call startContentShareFromScreenCapture or startContentShare.
            console.log("Screen share stopped");
        }
    };

    meetingSession.audioVideo.addContentShareObserver(screenShareObserver);
    meetingSession.audioVideo.addObserver(screenShareObserver);
}