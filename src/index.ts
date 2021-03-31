import { SignalingClient } from 'amazon-kinesis-video-streams-webrtc';
import * as AWS from 'aws-sdk';
import {ICredentials} from "./interfaces/ICredentials";
import {IClient} from "./interfaces/IClient";

let client: IClient;

export const startClient = async (event:string, credentials: ICredentials, masterView?: HTMLDivElement, viewerView?: HTMLDivElement, myClient?:IClient):Promise<T> => {
    
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

        const configuration = {
            iceServers
        };

        client.signalingClient.on('open', async () => {
            console.log('[MASTER] Connected to signaling service');
        });
    }
};
