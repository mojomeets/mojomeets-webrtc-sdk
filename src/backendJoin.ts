import * as AWS from "aws-sdk";
import { v4 as uuidv4 } from 'uuid';

const chime = new AWS.Chime();

// Set the AWS SDK Chime endpoint. The global endpoint is https://service.chime.aws.amazon.com.
chime.endpoint = new AWS.Endpoint("https://service.chime.aws.amazon.com");

const json = (statusCode:number, contentType:string, body:Object) => {
  return {
      statusCode,
      headers: { "content-type": contentType },
      body: JSON.stringify(body),
  };
};

export const join = async (event:any, context:any): Promise<Object> => {
    const query = event.queryStringParameters;
    let meetingId:string = '';
    let meeting:Object = {};

    // MongoDB request for geting the meeting
    if (!meeting) {
        //new meeting
        meetingId = uuidv4();
        meeting = await chime
            .createMeeting({
                ClientRequestToken: meetingId,
                MediaRegion: "eu-west-1",
                ExternalMeetingId: meetingId,
            })
            .promise();

        // Store the meeting in DB
    } else {
        //join to old meeting
        meetingId = query.meetingId;
        meeting = await chime
            .getMeeting({
                MeetingId: meetingId,
            })
            .promise();
    }

    //We've initialized our meeting! Now let's add attendees.
    const attendee = await chime
        .createAttendee({
            //ID of the meeting
            MeetingId: meeting.Meeting.MeetingId,

            //User ID that we want to associate to
            ExternalUserId: `${uuidv4().substring(0, 8)}#${query.clientId}`,
        })
        .promise();

    return json(200, "application/json", {
        Info: {
            Meeting: meeting,
            Attendee: attendee,
        },
    });
}


export const end = async (event:any, context:any): Promise<Object> => {
  const body = JSON.parse(event.body);
  // console.log(body.meetingId);
  const deleteRequest = await chime.deleteMeeting({
      MeetingId: body.meetingId
  }).promise();
  return json(200, "application/json", {});
};
