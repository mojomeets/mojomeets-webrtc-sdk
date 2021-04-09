import * as KVSWebRTC  from 'amazon-kinesis-video-streams-webrtc';
import * as AWS from 'aws-sdk';
import {ICredentials} from "./interfaces/ICredentials";
import {IClient} from "./interfaces/IClient";

let client: IClient;

export const startClient = async (event:string, credentials: ICredentials, localView?: HTMLDivElement, remoteView?: HTMLDivElement):Promise<T> => {

    if(event==="create-client"){

        // Create KVS client
        const kinesisVideoClient = new AWS.KinesisVideo({
            region: credentials.region,
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            correctClockSkew: true,
        });

        // Get signaling channel ARN
        const describeSignalingChannelResponse = await kinesisVideoClient
            .describeSignalingChannel({
                ChannelName: credentials.channelName,
            })
            .promise();
        // Can cause error
        const channelARN = describeSignalingChannelResponse.ChannelInfo!.ChannelARN;
        console.log('Channel ARN is: ', channelARN);

        // Get signaling channel endpoints
        if(!channelARN){
            return;
        }
        const getSignalingChannelEndpointResponse = await kinesisVideoClient
            .getSignalingChannelEndpoint({
                ChannelARN: channelARN,
                SingleMasterChannelEndpointConfiguration: {
                    Protocols: ['WSS', 'HTTPS'],
                    Role: credentials.role==="Master" ? KVSWebRTC.Role.MASTER : KVSWebRTC.Role.VIEWER
                },
            })
            .promise();
        if(!getSignalingChannelEndpointResponse.ResourceEndpointList)
            return
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
        const iceServers = [
            { urls: `stun:stun.kinesisvideo.${credentials.region}.amazonaws.com:443` }
        ];
        getIceServerConfigResponse.IceServerList.forEach((iceServer: any) =>
            iceServers.push({
                urls: iceServer.Uris,
                username: iceServer.Username,
                credential: iceServer.Password,
            }),
        );
        console.log('ICE servers: ', iceServers);

        // Storing ICE server urls in client object
        client.iceServers = iceServers;

        client.signalingClient.on('open', async () => {
            console.log('Connected to signaling service');
        });

        console.log('[MASTER] Starting master connection');
        client.signalingClient.open();

        client.signalingClient.on('close', () => {
            console.log('[MASTER] Disconnected from signaling channel');
        });

        client.signalingClient.on('error', () => {
            console.error('[MASTER] Signaling client error');
        });
    }

    else if(event==="publish"){
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
                client.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                localView!.srcObject = client.localStream;
            } catch (e) {
                console.error('Could not find webcam');
            }
        }

        const myIceServers = client.iceServers;
        const configuration = {
            myIceServers
        };

        client.signalingClient.on('sdpOffer', async (offer:any, remoteClientId:any):Promise<void> => {
            console.log('[MASTER] Received SDP offer from client: ' + remoteClientId);

            // Create a new peer connection using the offer from the given client
            const peerConnection = new RTCPeerConnection(configuration);
            client.peerConnectionByClientId[remoteClientId] = peerConnection;

            // For data messages
            // if (credentials.openDataChannel) {
            //     client.dataChannelByClientId[remoteClientId] = peerConnection.createDataChannel('kvsDataChannel');
            //     peerConnection.ondatachannel = event => {
            //         event.channel.onmessage = onRemoteDataMessage;
            //     };
            // }

            // Poll for connection stats
            if (!client.peerConnectionStatsInterval) {
                client.peerConnectionStatsInterval = setInterval(() => peerConnection.getStats());
            }

            // Send any ICE candidates to the other peer
            peerConnection.addEventListener('icecandidate', ({ candidate }) => {
                if (candidate) {
                    console.log('[MASTER] Generated ICE candidate for client: ' + remoteClientId);

                    // Sending ICE candidate
                    console.log('[MASTER] Sending ICE candidate to client: ' + remoteClientId);
                    client.signalingClient.sendIceCandidate(candidate, remoteClientId);
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
            if (client.localStream) {
                client.localStream.getTracks().forEach(track => peerConnection.addTrack(track, client.localStream));
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
            client.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId);
            console.log('[MASTER] Generating ICE candidates for client: ' + remoteClientId);
        });
    }

    else if(event === "subscribe"){
        client.signalingClient.on('iceCandidate', async (candidate:any, remoteClientId:any):Promise<T> => {
            console.log('[MASTER] Received ICE candidate from client: ' + remoteClientId);

            // Add the ICE candidate received from the client to the peer connection
            const peerConnection = client.peerConnectionByClientId[remoteClientId];
            peerConnection.addIceCandidate(candidate);
        });
    }
};
