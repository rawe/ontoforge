import { useQuery } from '@tanstack/react-query';
import { getFeatures } from '../api/runtimeClient';

export function useFeatures() {
  return useQuery({
    queryKey: ['features'],
    queryFn: getFeatures,
    staleTime: Infinity,
  });
}
