import * as KVSWebRTC from 'amazon-kinesis-video-streams-webrtc';
import * as AWS from 'aws-sdk';
import { ICredentials } from './interfaces/ICredentials';
import { IClient } from './interfaces/IClient';

import {attachVideo, getRandomClientId} from './helpers'

const client = {} as IClient;
client.peerConnectionByClientId = [];

let isStreamReceivedInViewer: boolean = false;


export const startClient = async (
  credentials: ICredentials,
  localView?: HTMLDivElement,
  remoteView?: HTMLDivElement,
): Promise<void> => {
  client.localView = localView!;
  client.remoteView = remoteView!;

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
  if (channelARN === '') {
    throw new Error('ChannelARN is empty');
  }
  console.log('Client Channel ARN is: ', channelARN);

  // Get signaling channel endpoints
  const getSignalingChannelEndpointResponse = await kinesisVideoClient
    .getSignalingChannelEndpoint({
      ChannelARN: channelARN,
      SingleMasterChannelEndpointConfiguration: {
        Protocols: ['WSS', 'HTTPS'],
        Role: credentials.role === 'MASTER' ? KVSWebRTC.Role.MASTER : KVSWebRTC.Role.VIEWER,
      },
    })
    .promise();

  ///////////////////// Can be undefined && Endpoints types are not proper
  const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList!.reduce(
    (endpoints: any, endpoint: any) => {
      endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
      return endpoints;
    },
    {},
  );
  console.log('Client Endpoints: ', endpointsByProtocol);

  if (credentials.role === 'MASTER') {
    // Create Signaling Client
    client.signalingClient = new KVSWebRTC.SignalingClient({
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
  } else {
    // Create Signaling Client
    client.signalingClient = new KVSWebRTC.SignalingClient({
      channelARN,
      channelEndpoint: endpointsByProtocol.WSS,
      clientId: getRandomClientId(),
      role: KVSWebRTC.Role.VIEWER,
      region: credentials.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
      systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });
  }

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
  client.iceServers = iceServers;

  const configuration: RTCConfiguration = {
    iceServers,
    iceTransportPolicy: 'all',
  };

  // Taking input from the page to send the video or audio or both
  const resolution = credentials.widescreen
    ? {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      }
    : { width: { ideal: 640 }, height: { ideal: 480 } };
  const constraints = {
    video: credentials.sendVideo ? resolution : false,
    audio: credentials.sendAudio,
  };

  // Get a stream from the webcam and display it in the local view.
  // If no video/audio needed, no need to request for the sources.
  // Otherwise, the browser will throw an error saying that either video or audio has to be enabled.
  if (credentials.sendVideo || credentials.sendAudio) {
    try {
      const mediaDevices = navigator.mediaDevices as any;
      if (credentials.shareScreen) {
        // Storing the screen video
        client.localStream = await mediaDevices.getDisplayMedia(constraints);
      } else {
        // Storing the video stream from webcam
        client.localStream = await mediaDevices.getUserMedia(constraints);
      }
      if (client.localStream) attachVideo(localView, client.localStream);
    } catch (e) {
      console.log('Could not find webcam, data is not transmitted');
    }
  }

  if (credentials.role === 'MASTER') {
    client.signalingClient.on(
      'open',
      async (): Promise<void> => {
        console.log('Connected to signaling service');
      },
    );

    /// Types are left
    client.signalingClient.on(
      'sdpOffer',
      async (offer: any, remoteClientId: any): Promise<void> => {
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

        ///////////////////////////////////// This is not working in test
        // As viewer's video data is received, add them to the remote view
        peerConnection.addEventListener('track', (event) => {
          console.log('[MASTER] Received remote track from client: ' + remoteClientId);
          attachVideo(remoteView, event.streams[0]);
        });

        // This is responsible for sending video tracks
        if (client.localStream) {
          client.localStream.getTracks().forEach((track: any) => {
            if (client.localStream) peerConnection.addTrack(track, client.localStream);
          });
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
        client.signalingClient.sendSdpAnswer(peerConnection.localDescription!, remoteClientId);
        console.log('[MASTER] Generating ICE candidates for client: ' + remoteClientId);
      },
    );

    // Receiving data as iceCandidates
    client.signalingClient.on(
      'iceCandidate',
      async (candidate: any, remoteClientId: any): Promise<any> => {
        console.log('[MASTER] Received ICE candidate from client: ' + remoteClientId);

        // Add the ICE candidate received from the client to the peer connection
        const peerConnection = client.peerConnectionByClientId[remoteClientId];
        await peerConnection.addIceCandidate(candidate);
      },
    );
  } else {
    client.peerConnection = new RTCPeerConnection(configuration);
    /* For Messaging */
    // if (credentials.openDataChannel) {
    //     viewer.dataChannel = viewer.peerConnection.createDataChannel('kvsDataChannel');
    //     viewer.peerConnection.ondatachannel = event => {
    //         event.channel.onmessage = onRemoteDataMessage;
    //     };
    // }

    // Poll for connection stats
    client.peerConnectionStatsInterval = setInterval(() => client.peerConnection.getStats());

    client.signalingClient.on(
      'open',
      async (): Promise<void> => {
        console.log('[VIEWER] Connected to signaling service');

        // This is responsible for sending video tracks
        if (client.localStream) {
          client.localStream.getTracks().forEach((track: any) => {
            if (client.localStream) client.peerConnection.addTrack(track, client.localStream);
          });
        }

        // Create an SDP offer to send to the master
        console.log('[VIEWER] Creating SDP offer');
        await client.peerConnection.setLocalDescription(
          await client.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          }),
        );

        console.log('[VIEWER] Sending SDP offer');
        client.signalingClient.sendSdpOffer(client.peerConnection.localDescription!);
        console.log('[VIEWER] Generating ICE candidates');
      },
    );

    // When the sdpAnswer is received from Master
    client.signalingClient.on(
      'sdpAnswer',
      async (answer: any): Promise<void> => {
        // Add the SDP answer to the peer connection
        console.log('[VIEWER] Received SDP answer');
        await client.peerConnection.setRemoteDescription(answer);
      },
    );

    // When iceCandidate is received from master
    client.signalingClient.on('iceCandidate', (candidate) => {
      // Add the ICE candidate received from the MASTER to the peer connection
      console.log('[VIEWER] Received ICE candidate');
      client.peerConnection.addIceCandidate(candidate);
    });

    // Send any ICE candidates to the other peer
    client.peerConnection.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) {
        console.log('[VIEWER] Generated ICE candidate');
        console.log('[VIEWER] Sending ICE candidate');
        client.signalingClient.sendIceCandidate(candidate);
      } else {
        console.log('[VIEWER] All ICE candidates have been generated');
      }
    });

    // As remote tracks are received, add them to the remote view
    client.peerConnection.addEventListener('track', (event) => {
      console.log('[VIEWER] Received remote track');

      // If the video data is already present
      // if (remoteView!.srcObject) {
      //     return;
      // }
      if (isStreamReceivedInViewer) {
        return;
      }

      client.remoteStream = event.streams[0];
      isStreamReceivedInViewer = true;
      // remoteView.srcObject = viewer.remoteStream;

      if (client.remoteStream) attachVideo(remoteView, client.remoteStream);
    });
  }

  client.signalingClient.on('close', () => {
    console.log('Disconnected from signaling channel');
  });

  client.signalingClient.on('error', (error) => {
    console.error('Signaling client error: ', error);
  });

  console.log('Starting client connection');
  client.signalingClient.open();
};

export const stopClient = (credentials: ICredentials) => {
  console.log('Stopping client connection');
  if (client.signalingClient) {
    client.signalingClient.close();
    // client.signalingClient = null;
  }

  if (credentials.role === 'MASTER') {
    Object.keys(client.peerConnectionByClientId).forEach((clientId: any) => {
      client.peerConnectionByClientId[clientId].close();
    });
    client.peerConnectionByClientId = [];

    client.remoteStreams.forEach((remoteStream) => remoteStream.getTracks().forEach((track: any) => track.stop()));
    client.remoteStreams = [];

    if (client.dataChannelByClientId) {
      client.dataChannelByClientId = {};
    }
  } else if (credentials.role === 'VIEWER') {
    if (client.peerConnection) {
      client.peerConnection.close();
      // client.peerConnection = null;
    }

    if (client.remoteStream) {
      client.remoteStream.getTracks().forEach((track: any) => track.stop());
      client.remoteStream = null;
    }

    if (client.dataChannel) {
      client.dataChannel = null;
    }
  }

  if (client.localStream) {
    client.localStream.getTracks().forEach((track: any) => track.stop());
    client.localStream = null;
  }

  if (client.peerConnectionStatsInterval) {
    clearInterval(client.peerConnectionStatsInterval);
    client.peerConnectionStatsInterval = null;
  }

  if (client.localView && client.localView.firstChild) {
    client.localView.removeChild(client.localView.firstChild);
  }

  if (client.remoteView && client.remoteView.firstChild) {
    client.remoteView.removeChild(client.remoteView.firstChild);
  }
};
