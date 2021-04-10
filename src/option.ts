import * as KVSWebRTC  from 'amazon-kinesis-video-streams-webrtc';
import * as AWS from 'aws-sdk';
import {ICredentials} from "./interfaces/ICredentials";
import {IMaster} from "./interfaces/IMaster";
import {IViewer} from "./interfaces/IViewer";

let master: IMaster;
let viewer: IViewer;

export const startMaster = async (credentials: ICredentials, localView?: HTMLDivElement, remoteView?: HTMLDivElement):Promise<void> => {
    
    master.localView = localView!;
    master.remoteView = remoteView!;

    // Create KVS client
    const kinesisVideoClient = new AWS.KinesisVideo({
        region: credentials.region,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken || '',
        correctClockSkew: true,
    });

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
        .describeSignalingChannel({
            ChannelName: credentials.channelName,
        })
        .promise();
    // Can cause error 
    const channelARN = describeSignalingChannelResponse.ChannelInfo!.ChannelARN || '';
    if(channelARN === ''){
        throw new Error('ChannelARN is empty');
    }
    console.log('Master Channel ARN is: ', channelARN);

    // Get signaling channel endpoints
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
        .getSignalingChannelEndpoint({
            ChannelARN: channelARN,
            SingleMasterChannelEndpointConfiguration: {
                Protocols: ['WSS', 'HTTPS'],
                Role:KVSWebRTC.Role.MASTER 
            },
        })
        .promise();

    ///////////////////// Can be undefined && Endpoints types are not proper
    const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList!.reduce((endpoints:any, endpoint:any) => {
        endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        return endpoints;
    }, {});
    console.log('Master Endpoints: ', endpointsByProtocol);

    // Create Signaling Client
    master.signalingClient = new KVSWebRTC.SignalingClient({
        channelARN,
        channelEndpoint: endpointsByProtocol.WSS,
        role: KVSWebRTC.Role.MASTER,
        region: credentials.region,
        credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
        },
        systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });

    // Get ICE server configuration
    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
        region: credentials.region,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
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
    ///////////// Can be undefined
    getIceServerConfigResponse.IceServerList!.forEach((iceServer: any) =>
        iceServers.push({
            urls: iceServer.Uris,
            username: iceServer.Username,
            credential: iceServer.Password,
        }),
    );
    console.log('ICE servers: ', iceServers);

    // Storing ICE server urls in client object
    master.iceServers = iceServers;

    const configuration:RTCConfiguration = {
        iceServers,
        iceTransportPolicy:'all',
    };

    // Taking input from the page to send the video or audio or both
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
            master.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            localView!.srcObject = master.localStream;
        } catch (e) {
            console.log('Could not find webcam, data is not transmitted');
        }
    }

    master.signalingClient.on('open', async ():Promise<void> => {
        console.log('Connected to signaling service');
    });

    /// Types are left
    master.signalingClient.on('sdpOffer', async (offer:any, remoteClientId:any):Promise<void> => {
        console.log('[MASTER] Received SDP offer from client: ' + remoteClientId);

        // Create a new peer connection using the offer from the given client
        const peerConnection = new RTCPeerConnection(configuration);
        master.peerConnectionByClientId[remoteClientId] = peerConnection;

        // For data messages
        // if (credentials.openDataChannel) {
        //     client.dataChannelByClientId[remoteClientId] = peerConnection.createDataChannel('kvsDataChannel');
        //     peerConnection.ondatachannel = event => {
        //         event.channel.onmessage = onRemoteDataMessage;
        //     };
        // }

        // Poll for connection stats
        if (!master.peerConnectionStatsInterval) {
            master.peerConnectionStatsInterval = setInterval(() => peerConnection.getStats());
        }

        // Send any ICE candidates to the other peer
        peerConnection.addEventListener('icecandidate', ({ candidate }) => {
            if (candidate) {
                console.log('[MASTER] Generated ICE candidate for client: ' + remoteClientId);

                // Sending ICE candidate
                console.log('[MASTER] Sending ICE candidate to client: ' + remoteClientId);
                master.signalingClient.sendIceCandidate(candidate, remoteClientId);
            } else {
                console.log('[MASTER] All ICE candidates have been generated for client: ' + remoteClientId);
            }
        });
 
        // As viewer's video data is received, add them to the remote view
        peerConnection.addEventListener('track', event => {
            console.log('[MASTER] Received remote track from client: ' + remoteClientId);
            if (remoteView!.srcObject) {
                return;
            }
            remoteView!.srcObject = event.streams[0];
        });

        // This is responsible for sending video tracks 
        if (master.localStream) {
            master.localStream.getTracks().forEach((track:any) => peerConnection.addTrack(track, master.localStream));
        }
        await peerConnection.setRemoteDescription(offer);

        // Create an SDP answer to send back to the client
        console.log('[MASTER] Creating SDP answer for client: ' + remoteClientId);
        await peerConnection.setLocalDescription(
            await peerConnection.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }),
        );

        // When trickle ICE is enabled, send the answer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
        console.log('[MASTER] Sending SDP answer to client: ' + remoteClientId);
        master.signalingClient.sendSdpAnswer(peerConnection.localDescription!, remoteClientId);
        console.log('[MASTER] Generating ICE candidates for client: ' + remoteClientId);
    });
    
    // Receiving data as iceCandidates
    master.signalingClient.on('iceCandidate', async (candidate:any, remoteClientId:any):Promise<T> => {
        console.log('[MASTER] Received ICE candidate from client: ' + remoteClientId);

        // Add the ICE candidate received from the client to the peer connection
        const peerConnection = master.peerConnectionByClientId[remoteClientId];
        peerConnection.addIceCandidate(candidate);
    });

    master.signalingClient.on('close', () => {
        console.log('[MASTER] Disconnected from signaling channel');
    });

    master.signalingClient.on('error', () => {
        console.error('[MASTER] Signaling client error');
    });

    console.log('[MASTER] Starting master connection');
    master.signalingClient.open();
};

export const startViewew = async (credentials: ICredentials, localView?: HTMLDivElement, remoteView?: HTMLDivElement):Promise<void> => {
    viewer.localView = localView!;
    viewer.remoteView = remoteView!;

    // Create KVS client
    const kinesisVideoClient = new AWS.KinesisVideo({
        region: credentials.region,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken || '',
        correctClockSkew: true,
    });

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
        .describeSignalingChannel({
            ChannelName: credentials.channelName,
        })
        .promise();
    // Can cause error 
    const channelARN = describeSignalingChannelResponse.ChannelInfo!.ChannelARN || '';
    if(channelARN === ''){
        throw new Error('ChannelARN is empty');
    }
    console.log('Viewer Channel ARN is: ', channelARN);

    // Get signaling channel endpoints
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
        .getSignalingChannelEndpoint({
            ChannelARN: channelARN,
            SingleMasterChannelEndpointConfiguration: {
                Protocols: ['WSS', 'HTTPS'],
                Role: KVSWebRTC.Role.VIEWER
            },
        })
        .promise();
    ///////////////////// Can be undefined && Endpoints types are not proper
    const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList!.reduce((endpoints:any, endpoint:any) => {
        endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        return endpoints;
    }, {});
    console.log('Viewer Endpoints: ', endpointsByProtocol);

    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
        region: credentials.region,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        endpoint: endpointsByProtocol.HTTPS,
        correctClockSkew: true,
    });

    // Get ICE server configuration
    const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
        .getIceServerConfig({
            ChannelARN: channelARN,
        })
        .promise();
    const iceServers = [];
    iceServers.push({ urls: `stun:stun.kinesisvideo.${credentials.region}.amazonaws.com:443` });
    ///////////// Can be undefined
    getIceServerConfigResponse.IceServerList!.forEach((iceServer: any) =>
        iceServers.push({
            urls: iceServer.Uris,
            username: iceServer.Username,
            credential: iceServer.Password,
        }),
    );
    console.log('ICE servers: ', iceServers);
    // Storing ICE server urls in client object
    viewer.iceServers = iceServers;

    // Create Signaling Client
    viewer.signalingClient = new KVSWebRTC.SignalingClient({
        channelARN,
        channelEndpoint: endpointsByProtocol.WSS,
        role: KVSWebRTC.Role.VIEWER,
        region: credentials.region,
        credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
        },
        systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });

    // Taking input from the page to send the video or audio or both
    const resolution = credentials.widescreen ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 640 }, height: { ideal: 480 } };
    const constraints = {
        video: credentials.sendVideo ? resolution : false,
        audio: credentials.sendAudio,
    };
    const configuration:RTCConfiguration = {
        iceServers,
        iceTransportPolicy:'all',
    };
    viewer.peerConnection = new RTCPeerConnection(configuration);
    /* For Messaging */
    // if (credentials.openDataChannel) {
    //     viewer.dataChannel = viewer.peerConnection.createDataChannel('kvsDataChannel');
    //     viewer.peerConnection.ondatachannel = event => {
    //         event.channel.onmessage = onRemoteDataMessage;
    //     };
    // }

    // Poll for connection stats
    viewer.peerConnectionStatsInterval = setInterval(() => viewer.peerConnection.getStats());

    viewer.signalingClient.on('open', async ():Promise<void> => {
        console.log('[VIEWER] Connected to signaling service');

        // Get a stream from the webcam and display it in the local view. 
        if (credentials.sendVideo || credentials.sendAudio) {
            try {
                // Storing the video stream from webcam
                viewer.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                // Sending the video tracks to peerConnection 
                viewer.localStream.getTracks().forEach((track:any) => viewer.peerConnection.addTrack(track, viewer.localStream));
                localView!.srcObject = viewer.localStream;
            } catch (e) {
                console.log('Could not find webcam, data is not transmitted');
            }
        }

        // Create an SDP offer to send to the master
        console.log('[VIEWER] Creating SDP offer');
        await viewer.peerConnection.setLocalDescription(
            await viewer.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }),
        );

        console.log('[VIEWER] Sending SDP offer');
        viewer.signalingClient.sendSdpOffer(viewer.peerConnection.localDescription!);
        console.log('[VIEWER] Generating ICE candidates');
    });

    // When the sdpAnswer is received from Master
    viewer.signalingClient.on('sdpAnswer', async (answer:any):Promise<void> => {
        // Add the SDP answer to the peer connection
        console.log('[VIEWER] Received SDP answer');
        await viewer.peerConnection.setRemoteDescription(answer);
    });

    // When iceCandidate is received from master
    viewer.signalingClient.on('iceCandidate', candidate => {
        // Add the ICE candidate received from the MASTER to the peer connection
        console.log('[VIEWER] Received ICE candidate');
        viewer.peerConnection.addIceCandidate(candidate);
    });

    // Send any ICE candidates to the other peer
    viewer.peerConnection.addEventListener('icecandidate', ({ candidate }) => {
        if (candidate) {
            console.log('[VIEWER] Generated ICE candidate');
            console.log('[VIEWER] Sending ICE candidate');
            viewer.signalingClient.sendIceCandidate(candidate);
        } else {
            console.log('[VIEWER] All ICE candidates have been generated');
        }
    });

    // As remote tracks are received, add them to the remote view
    viewer.peerConnection.addEventListener('track', event => {
        console.log('[VIEWER] Received remote track');
        if (remoteView!.srcObject) {
            return;
        }
        viewer.remoteStream = event.streams[0];
        remoteView!.srcObject = viewer.remoteStream;
    });

    viewer.signalingClient.on('close', () => {
        console.log('[VIEWER] Disconnected from signaling channel');
    });

    viewer.signalingClient.on('error', error => {
        console.error('[VIEWER] Signaling client error: ', error);
    });

    console.log('[VIEWER] Starting viewer connection');
    viewer.signalingClient.open();
};

