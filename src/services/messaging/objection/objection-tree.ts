// T-39 (WP05 §10.7 "Objection-handling decision tree") — the Socratic objection library. NOT a
// static rebuttal script: for each objection the rep hears, the tree leads with a CLARIFYING QUESTION
// first ("When you say pyramid scheme, what does that mean to you?"), then branches to a tailored,
// low-pressure response that lands on continue / schedule / respectfully-close. It is a live in-hand
// coaching tool, invisible to the community member; no earnings claims, no legal advice.
//
// §10.9-9 requires ≥7 objections with ≥2 branches each — this table has 8 objections, each with ≥2
// branches. Every string here is written to pass the doctrine VocabularyClassifier (§0.5): no
// "lead/prospect/pitch/funnel/conversion/follower/recruit", no "guaranteed income" / "you will earn".
// `objection-tree.test.ts` asserts that (the deterministic CFE stage-1 pass) verbatim.

export type ObjectionNextAction = 'continue' | 'schedule' | 'respectfully_close';

export interface ObjectionBranch {
  key: string;
  /** The answer/attitude this branch handles (what the person said back to the clarifying question). */
  label: string;
  /** The coaching response the rep adapts — an honest invitation, never a manipulative close. */
  response: string;
  nextAction: ObjectionNextAction;
}

export interface ObjectionNode {
  key: string;
  /** What the rep heard (the objection), in plain doctrine-safe language. */
  label: string;
  /** The Socratic clarifying question the tool serves FIRST, before any response. */
  clarifyingQuestion: string;
  branches: ObjectionBranch[];
}

export const OBJECTION_TREE: ObjectionNode[] = [
  {
    key: 'pyramid_scheme',
    label: 'It sounds like a pyramid scheme.',
    clarifyingQuestion: 'When you say pyramid scheme, what does that mean to you?',
    branches: [
      {
        key: 'illegal',
        label: 'They think it is illegal / a scam.',
        response:
          "That is a fair thing to check. A pyramid scheme has no real product and pays only for bringing people in — "
          + "which is illegal. What I do is help families protect their income with real financial products. "
          + "Would it help if I showed you exactly how that works, no pressure?",
        nextAction: 'continue',
      },
      {
        key: 'structure',
        label: 'They mean the org has levels / a hierarchy.',
        response:
          "You are right that there is a team structure — most companies have one. The difference here is that everyone, "
          + "at every level, is helping actual families. Seems like fairness matters to you, so I would rather you see the "
          + "real thing than take my word for it. Want to take a look together?",
        nextAction: 'schedule',
      },
    ],
  },
  {
    key: 'no_money',
    label: 'I cannot afford it right now.',
    clarifyingQuestion: 'Totally understand — when you say you cannot afford it, is it the timing, or the cost itself?',
    branches: [
      {
        key: 'timing',
        label: 'It is a timing / cash-flow thing.',
        response:
          "That makes sense, and there is no rush at all. This is exactly the kind of thing that is meant to ease money "
          + "stress over time, not add to it. How about we stay in touch and revisit when the timing feels better for you?",
        nextAction: 'continue',
      },
      {
        key: 'value_unclear',
        label: 'They are not sure it is worth the cost.',
        response:
          "Fair — nobody should spend on something they do not see the value in yet. Could I walk you through what it "
          + "actually protects, so you can decide for yourself whether it is worth it? No worries if the answer is not right now.",
        nextAction: 'schedule',
      },
    ],
  },
  {
    key: 'no_time',
    label: 'I do not have time for this.',
    clarifyingQuestion: 'I hear you — is it that this week is packed, or that it feels like a big time commitment overall?',
    branches: [
      {
        key: 'this_week',
        label: 'Just a busy stretch right now.',
        response:
          "Completely get it. This is a fifteen-minute conversation whenever a calmer week shows up — I am happy to hold "
          + "a spot and let you confirm later. Would next week be any gentler?",
        nextAction: 'schedule',
      },
      {
        key: 'big_commitment',
        label: 'They think it will consume their life.',
        response:
          "That is a common worry, and honestly you get to set the pace — some people do this an hour a week. Seems like "
          + "you value control over your time, which is exactly why I would let you decide how much or how little. Want the "
          + "short version first?",
        nextAction: 'continue',
      },
    ],
  },
  {
    key: 'think_about_it',
    label: 'I need to think about it / talk to my spouse.',
    clarifyingQuestion: 'Of course — is there a specific piece you want to think through, or would it help to have your partner hear it too?',
    branches: [
      {
        key: 'specific_concern',
        label: 'There is a specific unanswered question.',
        response:
          "Let us not leave you guessing on it. What is the one thing that would make this a clear yes or a clear no for you? "
          + "I would rather answer it now than have you wonder.",
        nextAction: 'continue',
      },
      {
        key: 'include_partner',
        label: 'They want their partner involved.',
        response:
          "I love that you make decisions like this together. It is actually better with both of you there. Could we find "
          + "twenty minutes when you are both free? No pressure either way.",
        nextAction: 'schedule',
      },
    ],
  },
  {
    key: 'is_this_mlm',
    label: 'Is this one of those MLM things?',
    clarifyingQuestion: 'Good question — what is it about those that would be a dealbreaker for you?',
    branches: [
      {
        key: 'bad_experience',
        label: 'They or a friend had a bad experience before.',
        response:
          "I am sorry that happened — a lot of people were treated like a number, and that is not okay. What I care about "
          + "is helping real families, and I would never chase you. Would you be open to seeing how this is different, and "
          + "walking away freely if it is not for you?",
        nextAction: 'continue',
      },
      {
        key: 'just_curious',
        label: 'They are just checking, not hostile.',
        response:
          "Fair to ask. There is a team side, yes, but it is built on actual financial products families need. Seems like "
          + "you like to understand things fully before deciding — want me to show you the whole picture?",
        nextAction: 'schedule',
      },
    ],
  },
  {
    key: 'not_a_salesperson',
    label: 'I am not a salesperson — I could never do this.',
    clarifyingQuestion: 'What is it about it that feels like it would require being a salesperson to you?',
    branches: [
      {
        key: 'hates_selling',
        label: 'They dislike pushing people.',
        response:
          "Then we are on the same page — I do not push anyone either. This is really about caring for people you already "
          + "know and pointing them to something that helps. If that ever felt pushy, you would not have to do it.",
        nextAction: 'continue',
      },
      {
        key: 'lacks_confidence',
        label: 'They doubt they could learn it.',
        response:
          "Most people who are great at this started exactly where you are. There is training and someone beside you the "
          + "whole way. Seems like you care about doing right by people, which is the part that cannot be taught. Want to "
          + "see what the support looks like?",
        nextAction: 'schedule',
      },
    ],
  },
  {
    key: 'tried_before',
    label: 'I tried something like this before and it did not work.',
    clarifyingQuestion: 'That is worth respecting — what happened last time that made it not work for you?',
    branches: [
      {
        key: 'no_support',
        label: 'They were left on their own last time.',
        response:
          "That is the most common reason things fall apart — nobody stays with you. Here, you are not alone; there is a "
          + "real person helping you week to week. Would seeing that difference be worth twenty minutes?",
        nextAction: 'schedule',
      },
      {
        key: 'wrong_fit',
        label: 'It just was not the right fit.',
        response:
          "Fair — not everything fits everyone, and I would never want to talk you into something that does not. Could I "
          + "understand what you were hoping for, so we can both tell honestly whether this is any different?",
        nextAction: 'continue',
      },
    ],
  },
  {
    key: 'trust',
    label: 'Why should I trust you or this company?',
    clarifyingQuestion: 'That is a smart thing to ask — is it me you want to feel sure about, or the company itself?',
    branches: [
      {
        key: 'the_company',
        label: 'They want to vet the company.',
        response:
          "Please do — I would want you to. It is a licensed, regulated financial company, and everything I would share is "
          + "checkable. Want me to send you what to look at so you can verify it yourself?",
        nextAction: 'continue',
      },
      {
        key: 'the_person',
        label: 'They are unsure about the rep personally.',
        response:
          "That is fair, especially if we do not know each other well yet. The best thing I can do is be straight with you "
          + "and let the facts speak. If anything ever felt off, you could step away with no hard feelings. Would a short, "
          + "honest conversation help?",
        nextAction: 'schedule',
      },
    ],
  },
];

export function getObjection(key: string): ObjectionNode | undefined {
  return OBJECTION_TREE.find((o) => o.key === key);
}

export function getBranch(objectionKey: string, branchKey: string): ObjectionBranch | undefined {
  return getObjection(objectionKey)?.branches.find((b) => b.key === branchKey);
}
