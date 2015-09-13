var
  Slack = require('slack-client'),
  Agenda = require('agenda'),
  SlackMessage = require('./node_modules/slack-client/src/message.js'),
  Survey = require('./survey.js'),
  BOT_TOKEN,
  autoReconnect = true,
  autoMark = true,
  slack,
  agenda,
  surveys = {},
  timestamps = {};

function findSurvey(ts, channel) {
  return surveys[timestamps[ts + ':' + channel]];
}

function formResponse(reaction, survey) {
  return {
    responder: {
      id: reaction.user,
      name: slack.getUserByID(reaction.user).name
    },
    answer: survey.getChoiceByIcon(reaction.reaction)
  };
}

function handleReactionAdded(reaction) {
  var survey, response, channel, message, userResponses;
  if (reaction.item.type === 'message' && reaction.user !== slack.self.id) {
    survey = findSurvey(reaction.item.ts, reaction.item.channel);
    if (survey) {
      userResponses = survey.getUserAnswersForInstance(reaction.item.ts, reaction.user);
      if (!survey.maxReplies || userResponses.length < survey.maxReplies) {
        // collect the response
        response = formResponse(reaction, survey);
        survey.instances[reaction.item.ts].push(response);
        survey.emit("response_added", response);
      } else {
        // notify the user they're out of responses
        channel = slack.getChannelByID(reaction.item.channel);
        message = "<@" + reaction.user + "> Oops! That response won't count, but would you kindly remove it again anyways?";
        channel.send(message);
      }
    }
  }
}

function handleReactionRemoved(reaction) {
  var survey, index, removed;
  if (reaction.item.type === 'message') {
    survey = findSurvey(reaction.item.ts, reaction.item.channel);
    if (survey) {
      index = survey.findResponseIndex(reaction.item.ts, reaction.user, reaction.reaction);
      if (index > -1) {
        removed = survey.instances[reaction.item.ts].splice(index, 1);
        survey.emit("response_removed", removed[0]);
      }
    }
  }
}

function handleConfirmation(confirmation) {
  var
    m = slack._pending[confirmation.reply_to],
    survey = surveys[m.survey_id];
  // survey is ready, post the initial reactions
  if (survey) {
    timestamps[confirmation.ts + ':' + m.channel_id] = survey.id; // associate the timestamp/message with its survey (for easy accessing later)
    survey.instances[confirmation.ts] = []; // for the responses
    survey.postReactions(slack, confirmation.ts);
  }
}


function addEventListeners() {
  slack.on('raw_message', function(message) {
    if (message.type === 'reaction_added') {
      handleReactionAdded(message);
    } else if (message.type === 'reaction_removed') {
      handleReactionRemoved(message);
    } else if (message.reply_to && message.ok) {
      handleConfirmation(message);
    }
  });
}


function runSurvey(job, done) {
  var
    opts = job.attrs.data,
    survey = surveys[opts.survey_id],
    channel = slack.getChannelByName(opts.channel),
    question;

  if (!channel) return done();

  survey.channelID = channel.id;

  // construct the message
  var message = '';
  if (opts.loud) {
    message += "@channel "
  }

  message += opts.question + '\n';
  message += "(";

  opts.choices.forEach(function(item) {
    message += ':' + item.icon + ': ' + item.label + ' ';
  });

  message = message.substring(0, message.length - 1); //chop off the extra " "
  message += ')' + '\n';

  if (opts.maxReplies && opts.maxReplies === 1) {
    message += "To answer, click on the reactions below. (Only your first selection will count)";
  } else if (opts.maxReplies && opts.maxReplies > 1) {
    message += "To answer, click on the reactions below. (Only your first " + opts.maxReplies + " selections will count)";
  } else {
    message += "To answer, click on the reactions below. (Click all that apply)"
  }

  survey.fullQuestion = message;
  question = new SlackMessage(slack, {
    text: message
  });
  question.channel = channel.id;
  question.survey_id = survey.id;
  question.channel_id = channel.id;
  slack._send(question);
  done();
}


var surveyor = {
  configure: function(opts) {
    // configure has to be run before addSurvey or start
    BOT_TOKEN = opts.token;
    agenda = new Agenda({
      db: {
        address: opts.mongoURL
      }
    });
  },
  addSurvey: function(opts) {
    var survey = new Survey(opts.question, opts.choices, opts.maxReplies, opts.channel);
    opts.survey_id = survey.id;
    agenda.define(survey.id, {}, runSurvey);
    if (opts.once) agenda.schedule(opts.once, survey.id, opts);
    if (opts.recurring) agenda.every(opts.recurring, survey.id, opts);
    surveys[survey.id] = survey;
    return survey;
  },
  removeSurvey: function(survey) {
    agenda.cancel({
      name: survey.id
    }, function(err, numRemoved) {});
    // find the survey in the surveys object and remove it from there
  },
  start: function() {
    slack = new Slack(BOT_TOKEN, autoReconnect, autoMark);
    addEventListeners();
    slack.login(); // listening for inbound
    agenda.start(); // scheduling outbound
  },
  stop: function() {
    agenda.stop();
  }
};

module.exports = surveyor;