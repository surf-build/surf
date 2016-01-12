import _ from 'lodash';

export default function determineChangedRefs(seenCommits, refInfo) {
  return _.filter(refInfo, (ref) => {
    if (seenCommits.has(ref.object.sha)) return false;
    seenCommits.add(ref.object.sha);

    return true;
  });
}
