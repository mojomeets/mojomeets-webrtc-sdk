import {
    ConsoleLogger,
    DefaultDeviceController,
    DefaultMeetingSession,
    LogLevel,
    MeetingSessionConfiguration,
    MeetingSessionStatus
  } from 'amazon-chime-sdk-js';

import {IMeeting} from "./interfaces/IMeeting";

var meetingSession:DefaultMeetingSession;

export const createMeeting = (meeting:IMeeting) => {

    const logger:ConsoleLogger = new ConsoleLogger('MyLogger', LogLevel.INFO);
    const deviceController: DefaultDeviceController = new DefaultDeviceController(logger);

    // You need responses from server-side Chime API. See below for details.
    const meetingResponse = meeting.meetingResponse;
    const attendeeResponse = meeting.attendeeResponse;

    const configuration:MeetingSessionConfiguration = new MeetingSessionConfiguration(meetingResponse, attendeeResponse);

    // In the usage examples below, you will use this meetingSession object.
    meetingSession = new DefaultMeetingSession(
        configuration,
        logger,
        deviceController
    );
}

export const deviceSelector = async():Promise<void> => {
    
    let audioInputDevices:MediaDeviceInfo[];
    let audioOutputDevices:MediaDeviceInfo[];
    let videoInputDevices:MediaDeviceInfo[];
    
    let audioInputDeviceInfo:MediaDeviceInfo;
    let audioOutputDeviceInfo:MediaDeviceInfo;
    let videoInputDeviceInfo:MediaDeviceInfo;
    
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
        audioInputsChanged: async (freshAudioInputDeviceList:MediaDeviceInfo[]):Promise<void> => {

            // An array of MediaDeviceInfo objects
            freshAudioInputDeviceList.forEach(mediaDeviceInfo => {
                console.log(`Device ID: ${mediaDeviceInfo.deviceId} Microphone: ${mediaDeviceInfo.label}`);
            });

            audioInputDeviceInfo = freshAudioInputDeviceList[0];
            await meetingSession.audioVideo.chooseAudioInputDevice(audioInputDeviceInfo.deviceId);
        
        },
        audioOutputsChanged: async (freshAudioOutputDeviceList:MediaDeviceInfo[]):Promise<void> => {

            console.log('Audio outputs updated: ', freshAudioOutputDeviceList);
            audioOutputDeviceInfo = freshAudioOutputDeviceList[0];
            await meetingSession.audioVideo.chooseAudioOutputDevice(audioOutputDeviceInfo.deviceId);

        },
        videoInputsChanged: async (freshVideoInputDeviceList:MediaDeviceInfo[]):Promise<void> => {

            console.log('Video inputs updated: ', freshVideoInputDeviceList);
            videoInputDeviceInfo = freshVideoInputDeviceList[0];
            await meetingSession.audioVideo.chooseVideoInputDevice(videoInputDeviceInfo.deviceId);

        }
    };
      
    meetingSession.audioVideo.addDeviceChangeObserver(observer);
}

export const startSession = (audioElement:HTMLAudioElement) => {

    meetingSession.audioVideo.bindAudioElement(audioElement);

    const startObserver = {
        audioVideoDidStart: () => {
            console.log('Started');
        }
    };

    meetingSession.audioVideo.addObserver(startObserver);

    meetingSession.audioVideo.start();

    const lifecycleObserver = {
        audioVideoDidStart: () => {
          console.log('Started');
        },
        audioVideoDidStop: (sessionStatus:MeetingSessionStatus) => {
          // See the "Stopping a session" section for details.
          console.log('Stopped with a session status code: ', sessionStatus.statusCode());
        },
        audioVideoDidStartConnecting: (reconnecting:boolean) => {
          if (reconnecting) {
            // e.g. the WiFi connection is dropped.
            console.log('Attempting to reconnect');
          }
        }
    };
      
    meetingSession.audioVideo.addObserver(lifecycleObserver);
}

