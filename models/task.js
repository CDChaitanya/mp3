var mongoose = require('mongoose');

var TaskSchema = new mongoose.Schema({
    name:             { type: String, required: [true, 'Task name is required'] },
    description:      { type: String, default: '' },
    deadline:         { type: Date,   required: [true, 'Deadline is required'] },
    completed:        { type: Boolean, default: false },
    assignedUser:     { type: String,  default: '' }, 
    assignedUserName: { type: String,  default: 'unassigned' },
    dateCreated:      { type: Date,    default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('Task', TaskSchema);
