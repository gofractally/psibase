import { Message } from "./types";

export const messages: Message[] = [
    {
        id: "1",
        subject: "Weekly Team Update",
        sender: {
            name: "Alex Johnson",
            email: "alex.johnson@example.com",
        },
        date: "2025-03-09T14:30:00",
        preview:
            "Here's a summary of what our team accomplished this week and our goals for next week.",
        content:
            "Hi Team,\n\nI hope this email finds you well. I wanted to share a quick update on our progress this week.\n\nThis week, we successfully launched the new feature we've been working on for the past month. The initial feedback has been very positive, with users particularly appreciating the improved user interface and faster load times.\n\nOur support team has reported a 15% decrease in related support tickets, which suggests that the new design is more intuitive for users.\n\nFor next week, we'll be focusing on addressing the minor bugs that have been reported and starting work on the next feature in our roadmap.\n\nPlease let me know if you have any questions or concerns.\n\nBest regards,\nAlex",
        read: false,
    },
    {
        id: "2",
        subject: "Project Deadline Extension",
        sender: {
            name: "Morgan Smith",
            email: "morgan.smith@example.com",
        },
        date: "2025-03-08T09:15:00",
        preview:
            "Good news! We've been granted a two-week extension for the project deadline.",
        content:
            "Hello,\n\nI'm pleased to inform you that our request for a deadline extension has been approved. We now have until March 25th to complete the project.\n\nThis additional time will allow us to implement the extra features requested by the client and ensure thorough testing before delivery.\n\nPlease adjust your schedules accordingly and let me know if you have any questions.\n\nThanks,\nMorgan",
        read: true,
    },
    {
        id: "3",
        subject: "New Office Policy",
        sender: {
            name: "Taylor Williams",
            email: "taylor.williams@example.com",
        },
        date: "2025-03-07T16:45:00",
        preview:
            "Please review the updated office policies that will take effect next month.",
        content:
            "Dear Colleagues,\n\nI'm writing to inform you about some updates to our office policies that will take effect starting next month.\n\nThe main changes include:\n\n1. Flexible working hours: You can now choose to start your workday between 7 AM and 10 AM, as long as you complete your 8 hours.\n\n2. Remote work: Each employee can work remotely up to 2 days per week, with prior approval from their manager.\n\n3. Meeting-free Fridays: To allow for focused work, we're implementing 'No Meeting Fridays' except for urgent matters.\n\nPlease review the attached document for the complete policy details.\n\nBest regards,\nTaylor Williams\nHR Director",
        read: true,
    },
    {
        id: "4",
        subject: "Client Presentation Feedback",
        sender: {
            name: "Jordan Lee",
            email: "jordan.lee@example.com",
        },
        date: "2025-03-06T11:20:00",
        preview:
            "Great job on yesterday's presentation! The client was very impressed with our proposal.",
        content:
            "Hi team,\n\nI wanted to share some feedback from yesterday's client presentation. In short, it was a huge success!\n\nThe client specifically mentioned how impressed they were with the depth of research and the innovative solutions we proposed. They particularly liked the phased implementation approach and the clear ROI projections.\n\nThey've asked for a follow-up meeting next week to discuss next steps, which is a very positive sign.\n\nGreat work everyone, especially to those who put in extra hours to prepare the materials.\n\nRegards,\nJordan",
        read: false,
    },
    {
        id: "5",
        subject: "Quarterly Budget Review",
        sender: {
            name: "Casey Brown",
            email: "casey.brown@example.com",
        },
        date: "2025-03-05T15:10:00",
        preview:
            "Please find attached the Q1 budget report and projections for Q2.",
        content:
            "Hello,\n\nAttached is the Q1 budget report for your review. Overall, we're tracking well against our annual plan with a few areas to monitor.\n\nKey points:\n\n- We're 5% under budget for Q1, primarily due to delayed hiring in the engineering department\n- Marketing expenses were 10% higher than projected, but this was offset by better than expected campaign results\n- Q2 projections show us on track, assuming we complete the planned hires by end of April\n\nPlease review the detailed report and let me know if you have any questions before our review meeting on Friday.\n\nBest,\nCasey\nFinance Director",
        read: true,
    },
    {
        id: "6",
        subject: "Company Picnic - Save the Date!",
        sender: {
            name: "Riley Garcia",
            email: "riley.garcia@example.com",
        },
        date: "2025-03-04T13:25:00",
        preview:
            "Our annual company picnic is scheduled for June 15th. Mark your calendars!",
        content:
            "Hello Everyone,\n\nI'm excited to announce that our annual company picnic will be held on Saturday, June 15th, from 11 AM to 4 PM at Riverside Park.\n\nThis year's theme is 'Summer Carnival' and we'll have games, food trucks, live music, and activities for all ages. Family members are welcome to join!\n\nPlease RSVP by May 20th using the form that will be sent out next week. If you'd like to volunteer to help organize the event, please let me know.\n\nLooking forward to a fun day together!\n\nBest,\nRiley\nEvents Coordinator",
        read: false,
    },
    {
        id: "7",
        subject: "System Maintenance Notice",
        sender: {
            name: "Avery Martinez",
            email: "avery.martinez@example.com",
        },
        date: "2025-03-03T10:05:00",
        preview:
            "The company servers will be down for maintenance this Saturday from 10 PM to 2 AM.",
        content:
            "Important Notice: Scheduled System Maintenance\n\nPlease be advised that our company servers will be undergoing scheduled maintenance this Saturday, March 8th, from 10 PM to 2 AM (EST).\n\nDuring this time, the following systems will be unavailable:\n- Email servers\n- Internal project management tools\n- Company intranet\n- Cloud storage\n\nPlease save your work and log out of all systems before 9:45 PM. Any unsaved work may be lost during the maintenance period.\n\nIf you have any urgent concerns, please contact the IT helpdesk.\n\nThank you for your cooperation,\nAvery Martinez\nIT Department",
        read: true,
    },
    {
        id: "8",
        subject: "Training Opportunity",
        sender: {
            name: "Quinn Thompson",
            email: "quinn.thompson@example.com",
        },
        date: "2025-03-02T14:50:00",
        preview:
            "New professional development courses are available. Sign up by March 15th.",
        content:
            "Dear Colleagues,\n\nI'm pleased to announce that we've expanded our professional development program with several new courses starting next month.\n\nNew courses include:\n- Advanced Project Management (2-day workshop)\n- Data Analysis with Python (online, self-paced)\n- Effective Communication in Leadership (1-day seminar)\n- UX Design Fundamentals (4-week course, one evening per week)\n\nThe company will cover the full cost of one course per employee this quarter. Additional courses can be taken with a 50% subsidy.\n\nTo register, please visit the Learning Portal and select your courses by March 15th.\n\nBest regards,\nQuinn Thompson\nLearning & Development",
        read: false,
    },
];
