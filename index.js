const express= require('express');
const bcrypt=require('bcrypt');
const app=express();
app.use(express.json());

//...........................CONNECTIVITY.............................

const { Client } = require('pg');
const connectionString = 'postgresql://kbzhrdb1:kbzhrdb1@kbzhrdbdev.c9x2ofbqrrou.us-east-1.rds.amazonaws.com/sanjana';

const client = new Client({
  connectionString,
})
client.connect()

//..........................HOST AND CONNECT CHECK...................................

app.get('/',(req,res)=>{
  res.send("hi");
});

app.get('/users',(req,res)=>{
  client.query('SELECT * FROM users',(err,result)=>{
    res.send(result.rows);
  });
  client.end;
});


//................................SIGNUP API....................................

app.post('/signup',async (req,res)=>{
    var user_pwd=req.body.password;
    var hashed_pwd= await bcrypt.hash(user_pwd,10);
    console.log(hashed_pwd);
    let insquery=`insert into users values('${req.body.username}', '${hashed_pwd}')`;
    client.query(insquery, (err,result)=>{
      if(!err){
        res.status(200).send({message:"successfully created"});
      }
      else{
        res.status(400).send("A Bad Request was sent. One of the parameters passed isn’t valid.")
      }
});
});


//...............................LOGIN API......................................

app.post('/login',async (req,res)=>{
  try{
    const check= await client.query(`select * from users where username='${req.body.username}'`);
    if(check.rowCount===0){
      res.status(400).send({message:"User does not exist."});
    }
    else if(await bcrypt.compare(req.body.password,check.rows[0].password)){
      res.status(200).send({message:"login successful", username:check.rows[0].username});
    }
    else{
      res.status(401).send({message:"Authorization information is missing or invalid."});
    }
  }catch(err){
    console.log(err);
  }
});


//...............................BOOK MEETING API...............................

app.post("/bookMeeting", async (req,res)=>{
  const booking = req.body;
  const check1 = await client.query(`select * from users where username='${booking.username}'`);
  if(check1.rowCount===0){
    res.status(403).send({message:"User does not exist, hence cannot book a meeting."});
  }
  else{
    var attendees=booking.attendees;
    var attendeesarr=attendees.split(",");
    attendeesarr.push(booking.username);
    console.log(attendeesarr);
    const check2= await client.query(`select username,start_time,end_time from newmeetings where date='${booking.date}'`);
    console.log(check2.rowCount);
    let flag=0;
    for (let i = 0; i < check2.rowCount; i++){
      if(!(booking.start_time>=check2.rows[i].end_time || booking.end_time<=check2.rows[0].start_time)){
        console.log("time clash");
        if(attendeesarr.includes(check2.rows[i].username)){
          console.log("user clash");
          flag=1;
          break;
        }
      }
    }
    if(flag===1){
      res.send({message:"Meeting not created. Another meeting is overlapping during this time slot"});
    }
    if(flag===0){
      const max_id= await client.query(`select max(meeting_id) from newmeetings`);
      var meet_id=max_id.rows[0].max +1;
      console.log(meet_id);
      console.log("Meeting added");
      const desc=booking.description || "";
      attendeesarr.forEach((item) => {
        client.query(`insert into newmeetings values(${meet_id},'${item}','${booking.date}',${booking.start_time},${booking.end_time},'${booking.title}','${desc}')`);
      });
      res.status(200).send({message:"Meeting booked!","Meeting ID":meet_id});
    }
  }
});


//..........................VIEW MEETING API....................................


app.get('/viewMeeting',async (req,res)=>{
  try{
  const details= await client.query(`select date,start_time,end_time,title,description from newmeetings where username='${req.body.username}' AND date BETWEEN '${req.body.start_date}' AND '${req.body.end_date}' GROUP BY date,start_time,end_time,title,description`);
  const start=req.body.start_date;
  const end=req.body.end_date;
  var sdt= new Date(start);
  var edt=new Date(end);
  var getInitialDict = function(sdt, edt) {
    for(var dict={};sdt<=edt; sdt.setDate(sdt.getDate()+1)){
        dict[new Date(sdt).toISOString().slice(0,10)]=[];
    }
    return dict;
  };
  var initDict= getInitialDict(sdt,edt);
  const meet_details=details.rows;
  meet_details.forEach((item) => {
    var appDict={};
    appDict["start_time"]=item.start_time;
    appDict["end_time"]=item.end_time;
    appDict["title"]=item.title;
    appDict["description"]=item.description;
    console.log(appDict);
    initDict[item.date].push(appDict);
  });
  res.status(200).send(initDict);
}catch(err){
  res.status(500).send({message:"Some error occured on the serevr."})
  console.log(err);
}
});


//..................................REPORT API..................................


app.get("/report",async (req,res)=>{
  try{
    const details= await client.query(`select username,start_time,end_time from newmeetings where date between '${req.body.start_date}' and '${req.body.end_date}'`);
    var timedict={};
    details.rows.forEach((item) => {
      if(!(timedict.hasOwnProperty(item.username))){
        timedict[item.username]=0;
      }
      var hrsdiff = Math.floor(item.end_time/100)-Math.floor(item.start_time/100)-1;
      var minsdiff= item.end_time%100 + (60-item.start_time%100);
      if(minsdiff>=60){
        hrsdiff+=1;
        minsdiff-=60;
      }
      var totalmins=(hrsdiff*60)+minsdiff;
      timedict[item.username]+=totalmins;
    });
    var arr=[];
    for(let key in timedict) {
      var newdict={};
      newdict["username"]=key;
      newdict["duration"]=timedict[key];
      arr.push(newdict);
    }
    arr.sort((a, b) => b.duration-a.duration);
    var n=req.body.users;
    var report_arr=arr.slice(0,n);
    report_arr.forEach((item) => {
      item.duration=item.duration+" min";
    });
    res.send({"users":report_arr});

  }catch(err){
    res.status(500).send({message:"Some error occured on the server."})
    console.log(err);
  }

});

app.listen(4000,()=>{
  console.log("listening");
});




//............................CANCEL MEETING API................................


app.post("/cancelMeeting", async (req,res)=>{
  var cancel_id=req.body.meeting_id;
  const checkid= await client.query(`select count(*) from newmeetings where meeting_id=${cancel_id}`);
  if(checkid.rows[0].count>0){
  const del= await client.query(`delete from newmeetings where meeting_id=${cancel_id}`);
  res.status(200).send({message:"Meeting cancelled!"});
}
else{
  res.status(400).send({message:"Invalid meeting id."})
}
});
