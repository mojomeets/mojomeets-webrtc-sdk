import { SignalingClient } from 'amazon-kinesis-video-streams-webrtc';
import * as AWS from 'aws-sdk';
import {ICredentials} from "./interfaces/ICredentials";
import {IClient} from "./interfaces/IClient";

let client: IClient;

export const startClient = async (masterView: HTMLDivElement, viewerView: HTMLDivElement, credentials: ICredentials):Promise<T> => {
    client.masterView = masterView;
    client.viewerView = viewerView;

    // Create KVS client
    const kinesisVideoClient = new AWS.KinesisVideo({
        region: credentials.region,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: undefined,
        endpoint: undefined,
        correctClockSkew: true,
    });

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
        .describeSignalingChannel({
            ChannelName: credentials.channelName,
        })
        .promise();
    const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
    console.log('Channel ARN is: ', channelARN);

    // Get signaling channel endpoints
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
        .getSignalingChannelEndpoint({
            ChannelARN: channelARN,
            SingleMasterChannelEndpointConfiguration: {
                Protocols: ['WSS', 'HTTPS'],
                Role: credentials.role==="Master" ? KVSWebRTC.Role.MASTER : KVSWebRTC.Role.VIEWER
            },
        })
        .promise();
    const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((endpoints:any, endpoint:any) => {
        endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        return endpoints;
    }, {});
    console.log('Endpoints: ', endpointsByProtocol);

    // Create Signaling Client
    client.signalingClient = new KVSWebRTC.SignalingClient({
        channelARN,
        channelEndpoint: endpointsByProtocol.WSS,
        role: credentials.role==="Master" ? KVSWebRTC.Role.MASTER : KVSWebRTC.Role.MASTER,
        region: credentials.region,
        credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: undefined,
        },
        systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });

    // Get ICE server configuration
    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
        region: credentials.region,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: undefined,
        endpoint: endpointsByProtocol.HTTPS,
        correctClockSkew: true,
    });
    const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
        .getIceServerConfig({
            ChannelARN: channelARN,
        })
        .promise();
    const iceServers = [];
    iceServers.push({ urls: `stun:stun.kinesisvideo.${credentials.region}.amazonaws.com:443` });
    
    getIceServerConfigResponse.IceServerList.forEach((iceServer: any) =>
        iceServers.push({
            urls: iceServer.Uris,
            username: iceServer.Username,
            credential: iceServer.Password,
        }),
    );
    console.log('ICE servers: ', iceServers);

    const configuration = {
        iceServers
    };

    const resolution = credentials.widescreen ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 640 }, height: { ideal: 480 } };
    const constraints = {
        video: credentials.sendVideo ? resolution : false,
        audio: credentials.sendAudio,
    };

    // Get a stream from the webcam and display it in the local view. 
    // If no video/audio needed, no need to request for the sources. 
    // Otherwise, the browser will throw an error saying that either video or audio has to be enabled.
    if (credentials.sendVideo || credentials.sendAudio) {
        try {
            // Storing the video stream from webcam
            client.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            masterView.srcObject = client.localStream;
        } catch (e) {
            console.error('[MASTER] Could not find webcam');
        }
    }
};
